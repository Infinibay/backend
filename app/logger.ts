import { createLogger, format, transports } from 'winston'
const { combine, timestamp, printf, colorize } = format

const logFormat = printf(({ level, message, timestamp, module, path, location }) => {
  const moduleStr = module ? ` (${module})` : ''
  return `${timestamp} [${level}]${moduleStr} ${message}${path ? ` (${path}` : ''}${location ? `, ${location})` : path ? ')' : ''}`
})

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'MMM-DD-YYYY HH:mm:ss' }),
        logFormat
      )
    }),
    new transports.File({
      filename: 'combined.log',
      format: combine(
        timestamp({ format: 'MMM-DD-YYYY HH:mm:ss' }),
        logFormat
      )
    })
  ]
})

export default logger
