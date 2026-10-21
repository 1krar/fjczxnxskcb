// Six-digit PINs are supported alongside previously configured long tokens.
export function validAccessToken(value) {
  return typeof value === 'string' && (value.length === 6 && /^\d{6}$/.test(value) || value.length >= 24 && value.length <= 512 && !/\s/.test(value));
}
