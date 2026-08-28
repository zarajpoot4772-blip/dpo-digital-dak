export const PASSWORD_MAX_AGE_DAYS = 90;

export function validatePassword(value: unknown) {
  const password = String(value || '');
  if (password.length < 10) throw new Error('Password must be at least 10 characters');
  if (password.length > 200) throw new Error('Password is too long');
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must include an uppercase letter, lowercase letter and number');
  }
  return password;
}

export function passwordExpiryDate(changedAt: unknown) {
  if (!changedAt) return null;
  const date = new Date(String(changedAt));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + PASSWORD_MAX_AGE_DAYS);
  return date;
}

export function isPasswordExpired(changedAt: unknown) {
  const expiry = passwordExpiryDate(changedAt);
  return !expiry || expiry.getTime() <= Date.now();
}
