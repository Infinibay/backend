import { createLogger, format, transports } from 'winston'
const { combine, timestamp, printf, prettyPrint } = format
const logger = createLogger({
  level: 'debug',
  format: combine(
    timestamp({
      format: 'MMM-DD-YYYY HH:mm:ss'
    }),
    printf(({ level, message, timestamp, path, location }) => {
      return `${timestamp} [${level}] ${message} (${path}, ${location})`
    }),
    prettyPrint()

  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'combined.log' })
  ]
})

export default logger
