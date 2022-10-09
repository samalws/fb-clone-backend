LAMBDA_MODE = process.env.LAMBDA_MODE === "1"

const { MongoClient, ObjectId } = require("mongodb")
const { gql, ApolloServer } = require(LAMBDA_MODE ? "apollo-server-lambda" : "apollo-server")
const { ApolloServerPluginLandingPageLocalDefault }  = require("apollo-server-core")
const keccak256 = require("keccak256")
const { randomBytes } = require("crypto")

// TODO delete post
// TODO is friends with query
// TODO friend requests

const typeDefs = gql`
type User {
  id: String!
  username: String!
  name: String!
  pfpLink: String!
  friends: [User!]!
  isFriendReqIn: Boolean!
  isFriendReqOut: Boolean!
  posts: [Post!]!
  replies: [Reply!]!
}

type Post {
  id: String!
  timestamp: Int!
  poster: User!
  message: String!
  imageLinks: [String!]!
  likes: Int!
  liked: Boolean!
  replies: [Reply!]!
}

type Reply {
  id: String!
  timestamp: Int!
  poster: User!
  message: String!
  likes: Int!
  liked: Boolean!
  replyTo: Post!
}

input Image {
  bucket: String!
  region: String!
  uuid: String!
  ext: String!
}

type Query {
  myUser(tok: String!): User
  lookupUserId(tok: String, id: String!): User
  lookupUsername(tok: String, username: String!): User
  lookupPostId(tok: String, id: String!): Post
  lookupReplyId(tok: String, id: String!): Reply
  feed(tok: String, pageNum: Int!): [Post]
}

type Mutation {
  setFriendStatus(tok: String!, id: String!, val: Boolean!): Boolean! # success?
  setLike(tok: String!, id: String!, like: Boolean!): Boolean! # success?
  makePost(tok: String!, message: String!, images: [Image!]!): Post
  makeReply(tok: String!, replyTo: String!, message: String!): Reply
  setAcctPrivacy(tok: String!, friendOnly: Boolean!): Boolean! # success?
  setAcctPassword(tok: String!, pwHashPreSalt: String!): Boolean! # success?
  makeAcct(username: String!, name: String!, pfp: Image!, pwHashPreSalt: String!): User
  login(id: String!, pwHashPreSalt: String!): String
  clearTok(tok: String!): Boolean! # success?
}
`

/* MONGODB SCHEMA:

type image = { bucket: string, region: string, uuid: string, ext: string }
users: { username: string, name: string, pfp: image, pwHash: string, pwSalt: string } (TODO username should be unique)
posts: { timestamp: int, poster: id, message: string, images: [image] }
replies: { timestamp: int, poster: id, message: string, replyTo: id }
friendReqs: { sender: id, receiver: id } unique
likes: { liker: id, post: id } unique
tokens: { user: id, tok: id, expires: string } (TODO remove after expiration date)

*/

const uri = process.env.MONGO_URI
const dbPromise = new MongoClient(uri).connect().then((client) => client.db("fb-clone"))

function imageToLink(image) {
  return "https://" + image.bucket + ".s3.amazonaws.com/" + image.uuid + "." + image.ext
}

function user(login, id) {
  var vals
  async function getVals() {
    const db = await dbPromise
    vals = (vals !== undefined) ? vals : db.collection("users").findOne({ _id: id }, { projection: { _id: 0, pwHash: 0, pwSalt: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    username: () => getField("username"),
    name: () => getField("name"),
    pfpLink: () => getField("pfp").then(imageToLink),
    isFriendReqIn: () => usersFriendReq(login, id, login),
    isFriendReqOut: () => usersFriendReq(login, login, id),
    friends: () => userFriends(login, id),
    posts: () => userPosts(login, id),
    replies: () => userReplies(login, id),
  }
}

async function lookupUser(login, query, projection) {
  const db = await dbPromise
  const lookuped = await db.collection("users").findOne(query, { projection })
  if (lookuped === null) return undefined
  const retVal = Object.assign({}, lookuped, query)
  retVal.id = retVal._id
  retVal.pfpLink = imageToLink(retVal.pfp)
  retVal.isFriendReqIn = () => usersFriendReq(login, retVal.id, login)
  retVal.isFriendReqOut = () => usersFriendReq(login, login, retVal.id)
  retVal.friends = () => userFriends(login, retVal.id)
  retVal.posts = () => userPosts(login, retVal.id),
  retVal.replies = () => userReplies(login, retVal.id)
  return retVal
}

function post(login, id) {
  var vals
  async function getVals() {
    const db = await dbPromise
    vals = (vals !== undefined) ? vals : db.collection("posts").findOne({ _id: id }, { projection: { _id: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    timestamp: () => getField("timestamp"),
    poster: () => getField("poster").then((uid) => user(login, uid)),
    message: () => getField("message"),
    imageLinks: () => getField("images").then((is) => is.map(imageToLink)),
    likes: () => getLikes(login, id),
    liked: () => getLiked(login, id),
    replies: () => postReplies(login, id),
  }
}

async function lookupPost(login, query, projection) {
  const db = await dbPromise
  const lookuped = await db.collection("posts").findOne(query, { projection })
  if (lookuped === null) return undefined
  const retVal = Object.assign({}, lookuped, query)
  retVal.id = retVal._id
  retVal.imageLinks = retVal.images.map(imageToLink)
  const oldPoster = retVal.poster
  retVal.poster = () => user(login, oldPoster)
  retVal.likes = () => getLikes(login, retVal.id)
  retVal.liked = () => getLiked(login, retVal.id)
  retVal.replies = () => postReplies(login, retVal.id)
  return retVal
}

function reply(login, id) {
  var vals
  async function getVals() {
    const db = await dbPromise
    vals = (vals !== undefined) ? vals : db.collection("replies").findOne({ _id: id }, { projection: { _id: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    timestamp: () => getField("timestamp"),
    poster: () => getField("poster").then((uid) => user(login, uid)),
    message: () => getField("message"),
    likes: () => getLikes(login, id),
    liked: () => getLiked(login, id),
    replyTo: () => getField("replyTo").then((pid) => post(login, pid)),
  }
}

async function lookupReply(login, query, projection) {
  const db = await dbPromise
  const lookuped = await db.collection("replies").findOne(query, { projection })
  if (lookuped === null) return undefined
  const retVal = Object.assign({}, lookuped, query)
  retVal.id = retVal._id
  const oldPoster = retVal.poster
  retVal.poster = () => user(login, oldPoster)
  retVal.likes = () => getLikes(login, retVal.id)
  retVal.liked = () => getLiked(login, retVal.id)
  const oldReplyTo = retVal.replyTo
  retVal.replyTo = () => post(login, oldReplyTo)
  return retVal
}

async function userFriends(login, id) {
  const db = await dbPromise
  const respA = await db.collection("friendReqs").find({ sender: id }, { projection: { _id: 0, receiver: 1 }})
  const listA = await respA.toArray()
  const respB = await db.collection("friendReqs").find({ receiver: id }, { projection: { _id: 0, sender: 1 }})
  const listB = await respB.toArray()
  const elemsA = {}
  listA.forEach(({ receiver }) => elemsA[receiver] = true)
  const retVal = []
  listB.forEach(({ sender }) => { if (elemsA[sender]) retVal.push(sender) })
  return retVal.map((uid) => user(login, uid))
}

async function usersFriendReq(login, sender, receiver) {
  const db = await dbPromise
  const resp = await db.collection("friendReqs").findOne({ sender, receiver }, { projection: { _id: 0, sender: 0, receiver: 0 }})
  return resp !== null
}

async function userPosts(login, id) {
  const db = await dbPromise
  const resp = await db.collection("posts").find({ poster: id }, { projection: { _id: 1 }})
  const list = await resp.toArray()
  return list.map(({ _id }) => post(login, _id))
}

async function userReplies(login, id) {
  const db = await dbPromise
  const resp = await db.collection("replies").find({ poster: id }, { projection: { _id: 1 }})
  const list = await resp.toArray()
  return list.map(({ _id }) => reply(login, _id))
}

async function postReplies(login, id) {
  const db = await dbPromise
  const resp = await db.collection("replies").find({ replyTo: id }, { projection: { _id: 1 }})
  const list = await resp.toArray()
  return list.map(({ _id }) => reply(login, _id))
}

async function getLikes(login, id) {
  const db = await dbPromise
  const retVal = await db.collection("likes").count({ post: id })
  return retVal
}

async function getLiked(login, id) {
  const db = await dbPromise
  const retVal = await db.collection("likes").findOne({ liker: login, post: id }, { projection: { _id: 0, liker: 0, post: 0 }})
  return retVal !== null
}

async function setFriendStatus(login, id, val) { // TODO test
  const db = await dbPromise
  const existsQuery = await db.collection("users").findOne({ _id: id }, { projection: { _id: 0, pwHash: 0, pwSalt: 0, /* TODO rest */ } })
  if (existsQuery === null) return false

  if (id === login) return false
  const query = { sender: login, receiver: id }
  if (val)
    await db.collection("friendReqs").insertOne(query)
  else
    await db.collection("friendReqs").deleteOne(query)
  return true
}

async function setLike(login, id, like) {
  const db = await dbPromise
  const existsQueryA = await db.collection("posts").findOne({ _id: id }, { projection: { _id: 0, timestamp: 0, poster: 0, message: 0 }})
  const existsQueryB = await db.collection("replies").findOne({ _id: id }, { projection: { _id: 0, timestamp: 0, poster: 0, message: 0, replyTo: 0 }})
  if (existsQueryA === null && existsQueryB === null) return false

  if (like) {
    try {
      await db.collection("likes").insertOne({ liker: login, post: id })
    } catch (err) {
      return false
    }
  } else
    await db.collection("likes").deleteOne({ liker: login, post: id })
  return true
}

async function makePost(login, message, images) {
  const query = {
    timestamp: Date.now(),
    poster: login,
    message,
    images, // TODO sanitize
  }
  const db = await dbPromise
  const response = await db.collection("posts").insertOne(query)
  const retVal = query
  retVal.id = response.insertedId
  retVal.poster = () => user(login, login)
  retVal.likes = 0
  retVal.liked = false
  retVal.replies = []
  return retVal
}

async function makeReply(login, replyTo, message) {
  const db = await dbPromise
  const existsQuery = await db.collection("posts").findOne({ _id: replyTo }, { projection: { _id: 0, timestamp: 0, poster: 0, message: 0 }})
  if (existsQuery === null) return undefined

  const query = {
    timestamp: Date.now(),
    poster: login,
    message,
    replyTo,
  }
  const response = await db.collection("replies").insertOne(query)
  const retVal = query
  retVal.id = response.insertedId
  retVal.poster = () => user(login, login)
  retVal.likes = 0
  retVal.liked = false
  retVal.replyTo = () => post(login, replyTo)
  return retVal
}

async function makeAcct(username, name, pfp, pwHashPreSalt) {
  const db = await dbPromise
  const salt = randomBytes(16)
  const pwHash = keccak256(salt.toString("base64")+pwHashPreSalt)
  try {
    // TODO sanitize pfp
    const response = await db.collection("users").insertOne({ username, name, pfp, pwHash, salt })
    return user(response.insertedId, response.insertedId)
  } catch (err) {
    return null
  }
}

async function login(id, pwHashPreSalt) {
  const db = await dbPromise
  const user = await db.collection("users").findOne({ _id: id }, { _id: 0, pwHash: 1, salt: 1 })
  if (user === null) return null

  const pwHash = keccak256(user.salt.toString("base64")+pwHashPreSalt)
  const userPwHash = Buffer.from(user.pwHash.toString("base64"), "base64")
  if (!pwHash.equals(userPwHash)) return null

  const tok = randomBytes(16)
  await db.collection("tokens").insertOne({ user: id, tok, expires: Date.now() + (1000*60*60*24*7 /* a week from now */) })

  return tok.toString("base64")
}

async function clearTok(tok) {
  const db = await dbPromise
  const response = db.collection("tokens").deleteOne({ tok })
  return response.deletedCount == 1
}

async function tokToId(tok) {
  if (tok == null) return false

  const db = await dbPromise
  // TODO we don't need to sanitize do we?
  const result = await db.collection("tokens").findOne({ tok: Buffer.from(tok, "base64") }, { _id: 0, tok: 0 })
  if (result == null || result.expiration < Date.now()) return null
  return result.user
}

function checkTokThen(fn, errCond, override) {
  if (override !== undefined) return ((parent, args, context, info) => fn(args))
  if (errCond === undefined) errCond = null
  async function retVal(parent, args, context, info) {
    var login = await tokToId(args.tok)
    if (login === null) return errCond
    if (login === false) login = null
    args.login = login
    try {
      const returnVal = await fn(args)
      return returnVal
    } catch (err) {
      console.log(err)
      return errCond
    }
  }
  return retVal
}

const resolvers = {
  Query: {
    myUser: [({ login }) => user(login, login)],
    lookupUserId: [({ login, id }) => lookupUser(login, { _id: new ObjectId(id) }, { _id: 0, pwHash: 0, pwSalt: 0 })],
    lookupUsername: [({login, username }) => lookupUser(login, { username }, { username: 0, pwHash: 0, pwSalt: 0 })],
    lookupPostId: [({ login, id }) => lookupPost(login, { _id: new ObjectId(id) }, { _id: 0 })],
    lookupReplyId: [({ login, id }) => lookupReply(login, { _id: new ObjectId(id) }, { _id: 0 })],
    feed: [({ login, pageNum }) => []], // TODO
  },

  Mutation: {
    setFriendStatus: [({ login, id, val }) => setFriendStatus(login, new ObjectId(id), val), false],
    setLike: [({ login, id, like }) => setLike(login, new ObjectId(id), like), false],
    makePost: [({ login, message, images }) => makePost(login, message, images)],
    makeReply: [({ login, replyTo, message }) => makeReply(login, new ObjectId(replyTo), message)],
    setAcctPrivacy: [({ login, friendOnly }) => false, false], // TODO
    setAcctPassword: [({ login, pwHashPreSalt }) => false, false], // TODO
    makeAcct: [({ username, name, pfp, pwHashPreSalt }) => makeAcct(username, name, pfp, pwHashPreSalt), undefined, true],
    login: [({ id, pwHashPreSalt }) => login(new ObjectId(id), pwHashPreSalt), undefined, true],
    clearTok: [({ tok }) => clearTok(tok), false, true],
  }
}

for (key in resolvers.Query) {
  const [fn, errCond, override] = resolvers.Query[key]
  resolvers.Query[key] = checkTokThen(fn, errCond, override)
}

for (key in resolvers.Mutation) {
  const [fn, errCond, override] = resolvers.Mutation[key]
  resolvers.Mutation[key] = checkTokThen(fn, errCond, override)
}

const server = new ApolloServer({typeDefs,resolvers,csrfPrevention: true,cache: "bounded",plugins: [ApolloServerPluginLandingPageLocalDefault({})]})
if (!LAMBDA_MODE) server.listen().then(({url}) => console.log("running server at", url))

if (LAMBDA_MODE) exports.handler = server.createHandler()
