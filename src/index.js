require('dotenv').config({ path: 'variables.env' })
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const createServer = require('./createServer')
const db = require('./db')

const server = createServer()

// use express middleware to handle cookies (JWT)
server.express.use(cookieParser())

// decode the JWT so we can get the user id on each request
server.express.use((req, res, next) => {
  const { token } = req.cookies

  if (token) {
    const { userId } = jwt.verify(token, process.env.APP_SECRET)

    // put the userId into the request for the furture requests to access
    req.userId = userId
  }

  next()
})

// create a middleware that populates the user on each request
server.express.use(
  async (req, res, next) => {
    // if the user isn't logged in, skip this
    if (!req.userId) {
      return next()
    }

    const user = await db.query.user(
      {
        where: { id: req.userId },
      },
      '{ id, name, email, permissions }',
    )

    req.user = user

    next()
  },
)

server.start(
  {
    cors: {
      credentials: true,
      origin: process.env.FRONTEND_URL,
    },
  },
  (deets) => {
    // eslint-disable-next-line
    console.log(`Server is up on port http://localhost:${deets.port}`)
  },
)
