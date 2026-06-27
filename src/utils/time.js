export function nowIso() {
  return new Date().toISOString();
}

export function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}
