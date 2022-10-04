const fs = require("fs")
const mongodb = require("mongodb")
const graphql = require("graphql")

class User {
  constructor(id) {
    this.id = id
    this.username = "Username"
    this.name = "Name"
    this.pfpLink = "PfpLink"
    this.isFriendReqIn = false
    this.isFriendReqOut = false
  }
  friends() {
    this.friends = [new User("friendIDA"), new User("friendIDB")]
    return this.friends
  }
  posts() {
    this.posts = [new Post("postIDA"), new Post("postIDB")]
    return this.posts
  }
  replies() {
    this.replies = [new Reply("replyIDA"), new Reply("replyIDB")]
    return this.replies
  }
}

class Post {
  constructor(id) {
    this.id = id
    this.timestamp = "now lol"
    this.poster = new User("posterID")
    this.message = "i love sneed!"
    this.likes = 1000
    this.liked = true
  }
  replies() {
    this.replies = [new Reply("replyIDC"), new Reply("replyIDD")]
    return this.replies
  }
}

class Reply {
  constructor(id) {
    this.id = id
    this.timestamp = "now lol"
    this.poster = new User("posterID")
    this.message = "i love sneed!"
    this.likes = 1000
    this.liked = true
    this.replyTo = new Post("replied to")
  }
}

const schemaContents = fs.readFileSync("backendSchema.gql", { encoding: "utf8" })
const schema = graphql.buildSchema(schemaContents)

const source = '{ myUser(tok: "asdf") { id, username, name, pfpLink, isFriendReqIn, isFriendReqOut, friends { friends { id } }, posts { id, replies { id } } } }'

const rootValue = {
  myUser: ({ tok }) => new User("myID")
}

graphql.graphql({ schema, source, rootValue }).then((ret) => console.log(JSON.stringify(ret)))
