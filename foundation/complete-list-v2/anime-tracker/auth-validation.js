export function validateAuthFields({ mode, email, password, confirmPassword = '' }) {
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) return 'Enter a valid email address.';
  if (!password) return 'Enter your password.';
  if (mode === 'register' && password !== confirmPassword) return 'Your passwords do not match.';
  return '';
}
