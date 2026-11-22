import "dotenv/config";
import dotenv from "dotenv";

import { drizzle } from "drizzle-orm/node-postgres";
import { DatabasePool } from "./pool";

dotenv.config({path: "../.env"});

export const pool = new DatabasePool();
const db = drizzle({ client: pool });
export default db;
