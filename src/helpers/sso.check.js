// node src/helpers/sso.check.js
import assert from 'assert'
import { createRequire } from 'module'
import selfsigned from 'selfsigned'
import { normalizeCert, samlFor, spValues, ssoEmail } from './sso.js'

const require = createRequire(createRequire(import.meta.url).resolve('@node-saml/node-saml'))
const { SignedXml } = require('xml-crypto')

const store = new Map()
const lean = value => ({ lean: () => Promise.resolve(value) })
const Models = {
    SamlRequest: {
        create: ({ key, value }) => {
            store.set(key, value)
            return Promise.resolve({ createdAt: new Date() })
        },
        findOne: ({ key }) => lean(store.has(key) ? { value: store.get(key) } : null),
        findOneAndDelete: ({ key }) => {
            const value = store.get(key)
            store.delete(key)
            return lean(value === undefined ? null : { value })
        }
    }
}

const keys = await selfsigned.generate([{ name: 'commonName', value: 'idp.example' }], { days: 2, keySize: 2048, algorithm: 'sha256' })
const workspace = {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    sso: {
        idpSsoUrl: 'https://idp.example/sso',
        idpEntityId: 'https://idp.example',
        idpCert: normalizeCert(keys.cert),
        domains: ['acme.com']
    }
}
assert.ok(workspace.sso.idpCert)
assert.equal(normalizeCert('not a cert'), '')

function samlResponse(requestId, email) {
    const sp = spValues(workspace._id)
    const now = new Date()
    const later = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a1" Version="2.0" IssueInstant="${now.toISOString()}">` +
        '<saml:Issuer>https://idp.example</saml:Issuer>' +
        `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>` +
        `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" NotOnOrAfter="${later}" Recipient="${sp.acsUrl}"/></saml:SubjectConfirmation></saml:Subject>` +
        `<saml:Conditions NotBefore="${now.toISOString()}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${sp.entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
        `<saml:AuthnStatement AuthnInstant="${now.toISOString()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
        '</saml:Assertion>'
    const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r1" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${sp.acsUrl}" InResponseTo="${requestId}">` +
        '<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.example</saml:Issuer>' +
        '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' +
        `${assertion}</samlp:Response>`

    const sig = new SignedXml({
        privateKey: keys.private,
        publicCert: keys.cert,
        signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#'
    })
    sig.addReference({
        xpath: "//*[local-name(.)='Assertion']",
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#']
    })
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } })
    return sig.getSignedXml()
}

async function newRequestId() {
    store.clear()
    await samlFor(Models, workspace).getAuthorizeUrlAsync('', undefined, {})
    return [...store.keys()][0]
}

const b64 = xml => ({ SAMLResponse: Buffer.from(xml).toString('base64') })

// (a) valid signed response for user@acme.com passes, and its email is accepted
let requestId = await newRequestId()
const signed = samlResponse(requestId, 'User@Acme.com')
const { profile } = await samlFor(Models, workspace).validatePostResponseAsync(b64(signed))
assert.equal(ssoEmail(profile, workspace), 'user@acme.com')

// replay of the same response is rejected (InResponseTo consumed)
await assert.rejects(samlFor(Models, workspace).validatePostResponseAsync(b64(signed)))

// (b) a workspace that hasn't verified acme.com rejects the same identity
assert.throws(() => ssoEmail(profile, { sso: { domains: ['other.com'] } }), /not verified/)

// (c) tampered assertion is rejected
requestId = await newRequestId()
const tampered = samlResponse(requestId, 'user@acme.com').replace('user@acme.com</saml:NameID>', 'ceo@acme.com</saml:NameID>')
await assert.rejects(samlFor(Models, workspace).validatePostResponseAsync(b64(tampered)))

// unsolicited (IdP-initiated / unknown InResponseTo) is rejected
store.clear()
await assert.rejects(samlFor(Models, workspace).validatePostResponseAsync(b64(samlResponse('_unknown', 'user@acme.com'))))

console.log('sso.check ok')
process.exit(0)
