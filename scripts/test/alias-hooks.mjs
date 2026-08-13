// Resolves the project's `@/…` tsconfig path alias for `node --test`, which
// otherwise has no idea what `@/lib/db` means. Node's type stripping handles the
// TypeScript itself; this only rewrites the specifier.
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import { dirname, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..")

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = resolvePath(projectRoot, specifier.slice(2))
      // Bare alias paths omit the extension; `types` is a directory with index.ts.
      for (const candidate of [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
        try {
          return nextResolve(pathToFileURL(candidate).href, context)
        } catch {
          // try the next candidate
        }
      }
    }
    return nextResolve(specifier, context)
  },
})
