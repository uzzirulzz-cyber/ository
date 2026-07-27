import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "amf_forensics";

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!clientPromise) {
    if (!uri) throw new Error("MONGODB_URI is not set");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(dbName);
}

export const COLLECTIONS = {
  users: "users",
  sessions: "recoverySessions",
  items: "recoveredItems",
} as const;
