import validator from 'validator'
import Errors from '../../constants/Errors.js'

/**
 * Validate the sign up form
 */
function validateSignupForm(payload) {
  const errors = {}
  let isFormValid = true
  let message = ''
  
  if (!payload || typeof payload.email !== 'string' || !validator.isEmail(payload.email)) {
    isFormValid = false
    errors.email = 'Please provide a correct email address.'
  }

  if (!payload || typeof payload.password !== 'string' || payload.password.trim().length < 8) {
    isFormValid = false
    errors.password = 'Password must have at least 8 characters.'
  }

  if (!payload || typeof payload.fullName !== 'string' || payload.fullName.trim().length < 3) {
    isFormValid = false
    errors.fullName = 'Full Name must have at least 3 characters.'
  }

  if (!isFormValid) {
    message = 'Check the form for errors.'
  }

  return {
    success: isFormValid,
    message,
    errors
  }
}

/**
 * Validate the login form
 */
function validateLoginForm(payload) {
  const errors = []
  let isFormValid = true
  let message = ''

  if (!payload || typeof payload.email !== 'string' || payload.email.trim().length === 0) {
    isFormValid = false
    errors.push('Please provide your email address.')
  }

  if (!payload || typeof payload.password !== 'string' || payload.password.trim().length === 0) {
    isFormValid = false
    errors.push('Please provide your password.')
  }

  return {
    success: isFormValid,
    errors
  }
}

function handleMongoDuplicateError(err) {
  if (err?.code === 11000 && err.keyPattern?.email) {
    return {
      error: Errors.Authentication.DUPLICATE_EMAIL
    }
  } else {
    return {
      error: null
    }
  }
}

export default {
  validateSignupForm,
  validateLoginForm,
  handleMongoDuplicateError,
}
