const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const sgMail = require('@sendgrid/mail')
const { promisify } = require('util')
const { randomBytes } = require('crypto')
const { makeANiceEmail } = require('../mail')
const stripe = require('../stripe')
const { hasPermission } = require('../utils')

const Mutations = {
  async createItem(parent, args, { db, request }, info) {
    const { mutation } = db
    const { userId } = request

    // check if the user is logged in
    if (!userId) throw new Error('You Must Be Signed In!')

    const item = await mutation.createItem(
      {
        data: {
          // creating relationship between the Item and the User
          user: {
            connect: {
              id: userId,
            },
          },
          ...args,
        },
      },
      info,
    )

    return item
  },
  updateItem(parent, args, { db }, info) {
    const { id } = args
    const { mutation } = db

    // take a copy of the updates
    const updates = { ...args }

    // remove the ID from the updates
    delete updates.id

    // run the update method
    return mutation.updateItem(
      {
        data: updates,
        where: {
          id,
        },
      },
      info,
    )
  },
  async deleteItem(parent, args, { db, request }, info) {
    const { query, mutation } = db
    const { user, userId } = request
    const where = { id: args.id }

    // 1. find the item
    const item = await query.item({ where }, '{ id title user { id } }')

    // 2. check if they own that item, or have the permissions
    const ownsItem = item.user.id === userId
    const hasPermissions = user.permissions.some(
      (permission) => ['ADMIN', 'ITEMDELETE'].includes(permission),
    )

    if (!ownsItem && hasPermissions) {
      throw new Error('You aren\'t allowed!')
    }

    // 3. run the delete method
    return mutation.deleteItem({ where }, info)
  },
  async signup(parent, args, { db, response }, info) {
    const { name, email, password } = args
    const { query, mutation } = db

    if (name.length < 3) {
      throw new Error('Name length must be greater than 3.')
    }

    if (email.length === 0) {
      throw new Error('Enter a valid email.')
    }

    const usser = await query.user({ where: { email } })
    if (usser) throw new Error('This user exists')

    // lowercase the email
    const lowerCasedEmail = email.toLowerCase()

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // create the user in the database
    const user = await mutation.createUser(
      {
        data: {
          name,
          email: lowerCasedEmail,
          password: hashedPassword,
          permissions: { set: ['USER'] },
        },
      },
      info,
    )

    // create JWT token
    const token = jwt.sign(
      { userId: user.id },
      process.env.APP_SECRET,
    )

    // set the JWT as a cookie on the response
    response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
    })

    // return the user to the browser
    return user
  },
  async signin(parent, args, { db, response }) {
    const { email, password } = args
    const { query } = db
    const where = { email }

    // 1. check if there is a user with that email
    const user = await query.user({ where })
    if (!user) throw new Error('Invalid email or password!')

    // 2. check if the password is correct
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) throw new Error('Invalid email or password!')

    // 3. generate the JWT token
    const token = jwt.sign(
      { userId: user.id },
      process.env.APP_SECRET,
    )

    // 4. set the JWT as a cookie on the response
    response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
    })

    // 5. return the user
    return user
  },
  signout(parent, args, { response }) {
    response.clearCookie('token')

    return { message: 'GoodBye!' }
  },
  async requestReset(parent, args, { db }) {
    const { email } = args
    const { query, mutation } = db
    const where = { email }

    // 1. check if the user exists
    const user = await query.user(
      { where },
    )

    if (!user) throw new Error('No such user found for the email!')

    // 2. set a reset token and expiry on the user
    const resetToken = (await promisify(randomBytes)(20))
      .toString('hex')
    const resetTokenExpiry = Date.now() + 3600000 // 1 hour token

    await mutation.updateUser(
      {
        where,
        data: { resetToken, resetTokenExpiry },
      },
    )

    // 3. email the user a reset token
    sgMail.setApiKey(process.env.SENDGRID_API_KEY)
    const emailMessage = {
      to: user.email,
      from: 'Diarybun@diarybun.com',
      subject: 'Diarybun Password Reset Token',
      text: 'Your password reset token is here!',
      html: makeANiceEmail(`
        Your Password Reset Token is Here!
        \n\n
        <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">
          Click here to reset!
        </a>
      `),
    }
    await sgMail.send(emailMessage)

    // 4. return the message
    return { message: 'Thanks' }
  },
  async resetPassword(parent, args, { db, response }) {
    const { password, confirmPassword, resetToken } = args
    const { query, mutation } = db

    // 1. check if the passwords match
    if (password !== confirmPassword) {
      throw new Error('Your Passwords don\'t match!')
    }

    // 2. check if its a legit reset token

    // 3. check if its expired
    const [user] = await query.users(
      {
        where: {
          resetToken,
          resetTokenExpiry_gte: Date.now() - 3600000,
        },
      },
    )

    if (!user) {
      throw new Error('This token is either invalid or expired!')
    }

    // 4. hash their new password
    const hashedPassword = await bcrypt.hash(password, 10)

    // 5. save the new password to the user and remove old resetToken fields
    const updatedUser = await mutation.updateUser(
      {
        where: { email: user.email },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        },
      },
    )

    // 6. generate the JWT
    const token = jwt.sign(
      { userId: updatedUser.id },
      process.env.APP_SECRET,
    )

    // 7. set the JWT as a cookie on the response
    response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
    })

    // 8. return the new user
    return updatedUser
  },
  async updatePermissions(parent, args, { db, request }, info) {
    const { query, mutation } = db
    const { userId } = request

    // 1. check if the user is logged in
    if (!userId) {
      throw new Error('You Must Be Logged In!')
    }

    // 2. query the current user
    const currentUser = await query.user(
      {
        where: {
          id: userId,
        },
      },
      info,
    )

    // 3. check if the user have the permissions to do this
    hasPermission(currentUser, ['ADMIN', 'PERMISSIONUPDATE'])

    // 4. update the permissions
    return mutation.updateUser(
      {
        data: {
          permissions: {
            set: args.permissions,
          },
        },
        where: {
          id: args.userId,
        },
      },
      info,
    )
  },
  async addToCart(parent, args, { db, request }) {
    const { query, mutation } = db
    const { userId } = request

    // 1. make sure the user is signed in
    if (!userId) throw new Error('You Must Be Signed In!')

    // 2. query the users current cart
    const [existingCartItem] = await query.cartItems(
      {
        where: {
          user: { id: userId },
          item: { id: args.id },
        },
      },
    )

    // 3. check if that item is already in their cart and increment by 1 if it is
    if (existingCartItem) {
      return mutation.updateCartItem(
        {
          where: { id: existingCartItem.id },
          data: { quantity: existingCartItem.quantity + 1 },
        },
      )
    }

    // 4. if it is not, create a fresh cart item for the user
    return mutation.createCartItem(
      {
        data: {
          user: {
            connect: { id: userId },
          },
          item: {
            connect: { id: args.id },
          },
        },
      },
    )
  },
  async removeFromCart(parent, args, { db, request }, info) {
    const { query, mutation } = db
    const { userId } = request

    // 1. find the cart item
    const cartItem = await query.cartItem(
      {
        where: { id: args.id },
      },
      '{ id, user { id } }',
    )

    // make sure we found an item
    if (!cartItem) throw new Error('No Cart Item Found!')

    // 2. make sure the user own the cart item
    if (cartItem.user.id !== userId) {
      throw new Error('Cheating huhhh!')
    }

    // 3. delete the cart item
    mutation.deleteCartItem(
      {
        where: { id: args.id },
      },
      info,
    )
  },
  async createOrder(parent, args, { db, request }) {
    // 1. Query the current user and make sure they are signed in
    const { query, mutation } = db
    const { userId } = request

    if (!userId) throw new Error('You must be signed in to complete this order.')

    const user = await query.user(
      {
        where: { id: userId },
      },
      `{
        id
        name
        email
        cart {
          id
          quantity
          item { title price id description image largeImage }
        }
      }`,
    )

    // 2. recalculate the total for the price
    const amount = user.cart.reduce(
      (tally, cartItem) => tally + cartItem.item.price * cartItem.quantity,
      0,
    )

    // 3. Create the stripe charge (turn token into $$$)
    const charge = await stripe.charges.create({
      amount,
      currency: 'USD',
      source: args.token,
    })

    // 4. Convert the CartItems to OrderItems
    const orderItems = user.cart.map(
      (cartItem) => {
        const orderItem = {
          ...cartItem.item,
          quantity: cartItem.quantity,
          user: { connect: { id: userId } },
        }
        delete orderItem.id
        return orderItem
      },
    )

    // 5. create the Order
    const order = await mutation.createOrder({
      data: {
        total: charge.amount,
        charge: charge.id,
        items: { create: orderItems },
        user: { connect: { id: userId } },
      },
    })

    // 6. clean up - clear the users cart, delete cartItems
    const cartItemIds = user.cart.map((cartItem) => cartItem.id)

    await mutation.deleteManyCartItems({
      where: {
        id_in: cartItemIds,
      },
    })

    // 7. Return the Order to the client
    return order
  },
}

module.exports = Mutations
