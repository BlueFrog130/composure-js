// `bun src/bun.ts`: Bun serves the default export.
import { handle } from "@composurejs/adapter-bun"
import { app } from "./app.tsx"

export default handle(app, { port: Number(process.env.PORT ?? 3000) })
