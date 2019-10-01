require('dotenv').config({ path: 'variables.env' })

module.exports = require('stripe')(process.env.STRIPE_SECRET)
