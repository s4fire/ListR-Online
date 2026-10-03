export function validateAuthFields({ mode, email, password, confirmPassword = '', username = '' }) {
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) return 'Enter a valid email address.';
  if (mode === 'register') {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    if (!normalizedUsername) return 'Choose a username for Friends features.';
    if (!/^[a-z0-9][a-z0-9_]{2,19}$/.test(normalizedUsername)) return 'Use 3–20 letters, numbers, or underscores. Start with a letter or number.';
  }
  if (!password) return 'Enter your password.';
  if (mode === 'register' && password !== confirmPassword) return 'Your passwords do not match.';
  return '';
}
