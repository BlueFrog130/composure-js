import { serve } from "@composurejs/adapter-node"
import { app } from "./app.tsx"

const server = await serve(app)
console.info({ msg: "Listening", url: server.url })
