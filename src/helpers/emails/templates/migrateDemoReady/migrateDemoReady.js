import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const htmlPart = fs.readFileSync(join(__dirname, 'migrateDemoReady.html'), 'utf8')

export default {
    TemplateName: 'migrateDemoReady',
    SubjectPart: 'Your LiveDemo is ready',
    HtmlPart: htmlPart,
    TextPart: 'Your LiveDemo is ready: {{demoUrl}}'
}
