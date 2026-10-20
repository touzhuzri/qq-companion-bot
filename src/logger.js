function stamp() {
  return new Date().toISOString().slice(11, 23)
}

function emit(level, args) {
  const line = `[${stamp()}] [${level}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`
  ;(level === 'error' ? console.error : console.log)(line)
}

export const logger = {
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
}
