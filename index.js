const fs = require("fs")
const mongodb = require("mongodb")
const { gql, ApolloServer }  = require("apollo-server")
const { ApolloServerPluginLandingPageLocalDefault }  = require("apollo-server-core")

// TODO delete post or reply
// TODO right now timestamp is a number despite its type being a string
// TODO tok stuff, acct privacy stuff
// TODO return null/false if stuff errors
// TODO is friends with query
// TODO don't alphabetize when inserting a friend request
// TODO get a list of incoming and outgoing friend requests for my user

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
  timestamp: String!
  poster: User!
  message: String!
  likes: Int!
  liked: Boolean!
  replies: [Reply!]!
}

type Reply {
  id: String!
  timestamp: String!
  poster: User!
  message: String!
  likes: Int!
  liked: Boolean!
  replyTo: Post!
}

type Query {
  myUser(tok: String!): User!
  lookupUserId(tok: String, id: String!): User
  lookupUsername(tok: String, username: String!): User
  lookupPostId(tok: String, id: String!): Post
  lookupReplyId(tok: String, id: String!): Reply
  feed(tok: String, pageNum: Int!): [Post]
  login(id: String!, pwHashPreSalt: String!): String
}

type Mutation {
  setFriendStatus(tok: String!, id: String!, val: Boolean!): Boolean! # success?
  setLike(tok: String!, id: String!, like: Boolean!): Boolean! # success?
  makePost(tok: String!, message: String!): Post
  makeReply(tok: String!, replyTo: String!, message: String!): Reply
  setAcctPrivacy(tok: String!, friendOnly: Boolean!): Boolean! # success?
  setAcctPassword(tok: String!, pwHashPreSalt: String!): Boolean! # success?
}
`

var db

function user(tok, id) {
  var vals
  function getVals() {
    vals = (vals !== undefined) ? vals : db.collection("users").findOne({ _id: id }, { projection: { _id: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    username: () => getField("username"),
    name: () => getField("name"),
    pfpLink: () => getField("pfpLink"),
    isFriendReqIn: false, // TODO
    isFriendReqOut: false, // TODO
    friends: () => userFriends(tok, id),
    posts: () => userPosts(tok, id),
    replies: () => userReplies(tok, id),
  }
}

async function lookupUser(tok, query, projection) {
  const lookuped = await db.collection("users").findOne(query, { projection })
  if (lookuped === null) return undefined
  const retVal = Object.assign({}, lookuped, query)
  retVal.id = retVal._id
  retVal.isFriendReqIn = false // TODO
  retVal.isFriendReqOut = false // TODO
  retVal.friends = () => userFriends(tok, retVal.id)
  retVal.posts = () => userPosts(tok, retVal.id),
  retVal.replies = () => userReplies(tok, retVal.id)
  return retVal
}

function post(tok, id) {
  var vals
  function getVals() {
    vals = (vals !== undefined) ? vals : db.collection("posts").findOne({ _id: id }, { projection: { _id: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    timestamp: () => getField("timestamp"),
    poster: () => getField("poster").then((uid) => user(tok, uid)),
    message: () => getField("message"),
    likes: () => getLikes(tok, id),
    liked: () => getLiked(tok, id),
    replies: () => postReplies(tok, id),
  }
}

async function lookupPost(tok, query, projection) {
  const lookuped = await db.collection("posts").findOne(query, { projection })
  if (lookuped === null) return undefined
  const retVal = Object.assign({}, lookuped, query)
  retVal.id = retVal._id
  const oldPoster = retVal.poster
  retVal.poster = () => user(tok, oldPoster)
  retVal.likes = () => getLikes(tok, retVal.id)
  retVal.liked = () => getLiked(tok, retVal.id)
  retVal.replies = () => postReplies(tok, retVal.id)
  return retVal
}

function reply(tok, id) {
  var vals
  function getVals() {
    vals = (vals !== undefined) ? vals : db.collection("replies").findOne({ _id: id }, { projection: { _id: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    timestamp: () => getField("timestamp"),
    poster: () => getField("poster").then((uid) => user(tok, uid)),
    message: () => getField("message"),
    likes: () => getLikes(tok, id),
    liked: () => getLiked(tok, id),
    replyTo: () => getField("replyTo").then((pid) => post(tok, pid)),
  }
}

async function lookupReply(tok, query, projection) {
  const lookuped = await db.collection("replies").findOne(query, { projection })
  if (lookuped === null) return undefined
  const retVal = Object.assign({}, lookuped, query)
  retVal.id = retVal._id
  const oldPoster = retVal.poster
  retVal.poster = () => user(tok, oldPoster)
  retVal.likes = () => getLikes(tok, retVal.id)
  retVal.liked = () => getLiked(tok, retVal.id)
  const oldReplyTo = retVal.replyTo
  retVal.replyTo = () => post(tok, oldReplyTo)
  return retVal
}

// TODO should only return mutuals
async function userFriends(tok, id) {
  const respA = await db.collection("friends").find({ personA: id }, { projection: { _id: 0, personB: 1 }})
  const listA = await respA.toArray()
  const respB = await db.collection("friends").find({ personB: id }, { projection: { _id: 0, personA: 1 }})
  const listB = await respB.toArray()
  const list = listA.map(({ personB }) => personB).concat(listB.map(({ personA }) => personA))
  return list.map((uid) => user(tok, uid))
}

async function userPosts(tok, id) {
  const resp = await db.collection("posts").find({ poster: id }, { projection: { _id: 1 }})
  const list = await resp.toArray()
  return list.map(({ _id }) => post(tok, _id))
}

async function userReplies(tok, id) {
  const resp = await db.collection("replies").find({ poster: id }, { projection: { _id: 1 }})
  const list = await resp.toArray()
  return list.map(({ _id }) => reply(tok, _id))
}

async function postReplies(tok, id) {
  const resp = await db.collection("replies").find({ replyTo: id }, { projection: { _id: 1 }})
  const list = await resp.toArray()
  return list.map(({ _id }) => reply(tok, _id))
}

async function getLikes(tok, id) {
  const retVal = await db.collection("likes").count({ post: id })
  return retVal
}

async function getLiked(tok, id) {
  const retVal = await db.collection("likes").findOne({ liker: tok, post: id }, { projection: { _id: 0, liker: 0, post: 0 }})
  return retVal !== null
}

async function setFriendStatus(tok, id, val) { // TODO test
  const existsQuery = await db.collection("users").findOne({ _id: id }, { projection: { _id: 0, /* TODO rest */ } })
  if (existsQuery === null) return false

  if (id === tok) return false
  const query = id < tok ? { friendA: id, friendB: tok } : { friendA: tok, friendB: id }
  if (val)
    await db.collection("friends").insertOne(query)
  else
    await db.collection("friends").deleteOne(query)
  return true
}

async function setLike(tok, id, like) {
  const existsQueryA = await db.collection("posts").findOne({ _id: id }, { projection: { _id: 0, timestamp: 0, poster: 0, message: 0 }})
  const existsQueryB = await db.collection("replies").findOne({ _id: id }, { projection: { _id: 0, timestamp: 0, poster: 0, message: 0, replyTo: 0 }})
  if (existsQueryA === null && existsQueryB === null) return false

  if (like) {
    try {
      await db.collection("likes").insertOne({ liker: tok, post: id })
    } catch (err) {
      return false
    }
  } else
    await db.collection("likes").deleteOne({ liker: tok, post: id })
  return true
}

async function makePost(tok, message) {
  const query = {
    timestamp: Date.now(),
    poster: tok,
    message,
  }
  const response = await db.collection("posts").insertOne(query)
  const retVal = query
  retVal.id = response.insertedId
  retVal.poster = () => user(tok, tok)
  retVal.likes = 0
  retVal.liked = false
  retVal.replies = []
  return retVal
}

async function makeReply(tok, replyTo, message) {
  const existsQuery = await db.collection("posts").findOne({ _id: replyTo }, { projection: { _id: 0, timestamp: 0, poster: 0, message: 0 }})
  if (existsQuery === null) return undefined

  const query = {
    timestamp: Date.now(),
    poster: tok,
    message,
    replyTo,
  }
  const response = await db.collection("replies").insertOne(query)
  const retVal = query
  retVal.id = response.insertedId
  retVal.poster = () => user(tok, tok)
  retVal.likes = 0
  retVal.liked = false
  retVal.replyTo = () => post(tok, replyTo)
  return retVal
}

const resolvers = {
  Query: {
    myUser: ({ tok }) => user(new mongodb.ObjectId(tok), new mongodb.ObjectId(tok)),
    lookupUserId: ({ tok, id }) => lookupUser(new mongodb.ObjectId(tok), { _id: new mongodb.ObjectId(id) }, { _id: 0 }),
    lookupUsername: ({ tok, username }) => lookupUser(new mongodb.ObjectId(tok), { username }, { username: 0 }),
    lookupPostId: ({ tok, id }) => lookupPost(new mongodb.ObjectId(tok), { _id: new mongodb.ObjectId(id) }, { _id: 0 }),
    lookupReplyId: ({ tok, id }) => lookupReply(new mongodb.ObjectId(tok), { _id: new mongodb.ObjectId(id) }, { _id: 0 }),
    feed: ({ tok, pageNum }) => [], // TODO
    login: ({ id, pwHashPreSalt }) => id, // TODO
  },

  Mutation: {
    setFriendStatus: ({ tok, id, val }) => setFriendStatus(new mongodb.ObjectId(tok), new mongodb.ObjectId(id), val),
    setLike: ({ tok, id, like }) => setLike(new mongodb.ObjectId(tok), new mongodb.ObjectId(id), like),
    makePost: ({ tok, message }) => makePost(new mongodb.ObjectId(tok), message),
    makeReply: ({ tok, replyTo, message }) => makeReply(new mongodb.ObjectId(tok), new mongodb.ObjectId(replyTo), message),
    setAcctPrivacy: ({ tok, friendOnly }) => false, // TODO
    setAcctPassword: ({ tok, pwHashPreSalt }) => false, // TODO
  }
}

async function main() {
  const uri = process.env.MONGO_URI
  const mongoClient = new mongodb.MongoClient(uri)
  await mongoClient.connect()
  db = mongoClient.db("fb-clone")
  console.log("connected to database")

  const server = new ApolloServer({typeDefs,resolvers,plugins: [ApolloServerPluginLandingPageLocalDefault({})]})
  const listening = await server.listen()

  console.log("running server at", listening.url)
}

main()
