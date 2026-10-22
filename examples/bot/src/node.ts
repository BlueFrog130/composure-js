import { serve } from "composurejs/node"
import { app } from "./app.tsx"

const server = await serve(app)
console.info({ msg: "Listening", url: server.url })
