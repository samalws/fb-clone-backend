const mongodb = require("mongodb")

async function main() {
  const uri = process.env.MONGO_URI
  const mongoClient = new mongodb.MongoClient(uri)
  await mongoClient.connect()
  db = mongoClient.db("fb-clone")

  var result = await db.collection("users").createIndex({username: 1},{unique: true})
  console.log(result)
  result = await db.collection("friends").createIndex({personA: 1, personB: 1},{unique: true})
  console.log(result)
  result = await db.collection("likes").createIndex({liker: 1, post: 1},{unique: true})
  console.log(result)

  console.log("done")
}

main()
