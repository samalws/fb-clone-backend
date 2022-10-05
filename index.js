const fs = require("fs")
const mongodb = require("mongodb")
const graphql = require("graphql")

// TODO tok stuff, acct privacy stuff

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
    vals = (vals !== undefined) ? vals : db.collection("users").findOne({ _id: id }, { projection: { _id: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    timestamp: () => getField("timestamp"),
    poster: () => user(tok, getField("poster")),
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
  retVal.poster = () => user(tok, retVal.poster)
  retVal.likes = () => getLikes(tok, retVal.id)
  retVal.liked = () => getLiked(tok, retVal.id)
  retVal.replies = () => postReplies(tok, retVal.id)
  return retVal
}

function reply(tok, id) {
  var vals
  function getVals() {
    vals = (vals !== undefined) ? vals : db.collection("users").findOne({ _id: id }, { projection: { _id: 0 } })
    return vals
  }
  const getField = (f) => getVals().then((v) => v[f])
  return {
    id,
    timestamp: () => getField("timestamp"),
    poster: () => user(tok, getField("poster")),
    message: () => getField("message"),
    likes: () => getLikes(tok, id),
    liked: () => getLiked(tok, id),
    replyTo: () => post(tok, getField("replyTo")),
  }
}

async function lookupReply(tok, query, projection) {
  const lookuped = await db.collection("replies").findOne(query, { projection })
  if (lookuped === null) return undefined
  const retVal = Object.assign({}, lookuped, query)
  retVal.id = retVal._id
  retVal.poster = () => user(tok, retVal.poster)
  retVal.likes = () => getLikes(tok, retVal.id)
  retVal.liked = () => getLiked(tok, retVal.id)
  const oldReplyTo = retVal.replyTo
  retVal.replyTo = () => post(tok, oldReplyTo)
  return retVal
}

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

const rootValue = {
  myUser: ({ tok }) => user(new mongodb.ObjectId(tok), new mongodb.ObjectId(tok)),
  lookupUserId: ({ tok, id }) => lookupUser(new mongodb.ObjectId(tok), { _id: new mongodb.ObjectId(id) }, { _id: 0 }),
  lookupUsername: ({ tok, username }) => lookupUser(new mongodb.ObjectId(tok), { username }, { username: 0 }),
  lookupPostId: ({ tok, id }) => lookupPost(new mongodb.ObjectId(tok), { _id: new mongodb.ObjectId(id) }, { _id: 0 }),
  lookupReplyId: ({ tok, id }) => lookupReply(new mongodb.ObjectId(tok), { _id: new mongodb.ObjectId(id) }, { _id: 0 }),
  feed: ({ tok, pageNum }) => [], // TODO
  login: ({ id, pwHashPreSalt }) => id, // TODO

  setFriendStatus: ({ tok, id, val }) => false, // TODO
  setLike: ({ tok, id, like }) => false, // TODO
  makePost: ({ tok, message }) => null, // TODO
  reply: ({ tok, id, message }) => null, // TODO
  setAcctPrivacy: ({ tok, friendOnly }) => false, // TODO
  setAcctPassword: ({ tok, pwHashPreSalt }) => false, // TODO
}

async function main() {
  const uri = process.env.MONGO_URI
  const mongoClient = new mongodb.MongoClient(uri)
  await mongoClient.connect()
  db = mongoClient.db("fb-clone")
  console.log("connected!")

  const schemaContents = fs.readFileSync("backendSchema.gql", { encoding: "utf8" })
  const schema = graphql.buildSchema(schemaContents)

  // example query
  const source = '{ lookupUsername(tok: "633c86feaf773c87606e08fc", username: "Username0") { id, username, name, pfpLink, isFriendReqIn, isFriendReqOut, friends { id, friends { id } }, posts { id, likes, liked, replies { likes, liked, id } } } }'

  graphql.graphql({ schema, source, rootValue }).then((ret) => console.log("FINAL VALUE", JSON.stringify(ret)))
}

main()
