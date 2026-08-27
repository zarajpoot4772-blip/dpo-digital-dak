export function validatePassword(value: unknown) {
  const password = String(value || '');
  if (password.length < 10) throw new Error('Password must be at least 10 characters');
  if (password.length > 200) throw new Error('Password is too long');
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must include an uppercase letter, lowercase letter and number');
  }
  return password;
}
