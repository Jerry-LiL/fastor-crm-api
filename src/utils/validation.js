const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

function validateRegisterInput({ name, email, password }) {
  const details = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    details.push({ field: 'name', message: 'Name is required' });
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    details.push({ field: 'email', message: 'A valid email address is required' });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    details.push({ field: 'password', message: 'Password must be at least 8 characters long' });
  }

  return {
    isValid: details.length === 0,
    details,
  };
}

function validateLoginInput({ email, password }) {
  const details = [];

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    details.push({ field: 'email', message: 'A valid email address is required' });
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    details.push({ field: 'password', message: 'Password is required' });
  }

  return {
    isValid: details.length === 0,
    details,
  };
}

function validateEnquiryInput(body) {
  const details = [];
  const { name, email, phone, message } = body || {};
  const courseInterest = body?.courseInterest || body?.course_interest;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    details.push({ field: 'name', message: 'Name is required' });
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    details.push({ field: 'email', message: 'A valid email address is required' });
  }

  if (!phone || typeof phone !== 'string' || !PHONE_REGEX.test(phone.trim())) {
    details.push({
      field: 'phone',
      message: 'Phone number must contain 10 to 15 digits and may start with a leading +',
    });
  }

  if (!courseInterest || typeof courseInterest !== 'string' || courseInterest.trim().length === 0) {
    details.push({ field: 'courseInterest', message: 'Course interest is required' });
  }

  if (message !== undefined && message !== null && typeof message !== 'string') {
    details.push({ field: 'message', message: 'Message must be text' });
  }

  return {
    isValid: details.length === 0,
    details,
    data: {
      name: name ? name.trim() : '',
      email: email ? email.trim().toLowerCase() : '',
      phone: phone ? phone.trim() : '',
      courseInterest: courseInterest ? courseInterest.trim() : '',
      message: message ? message.trim() : null,
    },
  };
}

module.exports = {
  validateRegisterInput,
  validateLoginInput,
  validateEnquiryInput,
};
