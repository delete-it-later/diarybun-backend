const { forwardTo } = require('prisma-binding')
const { hasPermission } = require('../utils')

const Query = {
  item: forwardTo('db'),
  items: forwardTo('db'),
  itemsConnection: forwardTo('db'),
  async me(parent, args, { db, request }, info) {
    const { query } = db
    const { userId } = request
    const where = { id: userId }

    // check if there is a current user ID
    if (!userId) {
      return null
    }

    return query.user(
      { where },
      info,
    )
  },
  async users(parent, args, { db, request }, info) {
    const { query } = db
    const { user, userId } = request

    // 1. check if the user is logged in
    if (!userId) throw new Error('You Must Be Logged In!')

    // 2. check if the user has the permissions to query all the users
    hasPermission(user, ['ADMIN', 'PERMISSIONUPDATE'])

    // 3. query all the users
    return query.users({}, info)
  },
  async order(parent, args, { db, request }, info) {
    const { query } = db
    const { user, userId } = request

    // 1. make sure they are logged in
    if (!userId) {
      throw new Error('You arent logged in!')
    }

    // 2. query the current order
    const order = await query.order(
      {
        where: { id: args.id },
      },
      info,
    )

    // 3. check if the have the permissions to see this order
    const ownsOrder = order.user.id === userId
    const hasPermissionToSeeOrder = user.permissions.includes('ADMIN')
    if (!ownsOrder && !hasPermissionToSeeOrder) {
      throw new Error('You cant see this buddd')
    }

    // 4. return the order
    return order
  },
  async orders(parent, args, { db, request }, info) {
    const { query } = db
    const { userId } = request

    if (!userId) {
      throw new Error('you must be signed in!')
    }

    return query.orders(
      {
        where: {
          user: { id: userId },
        },
      },
      info,
    )
  },
}

module.exports = Query
