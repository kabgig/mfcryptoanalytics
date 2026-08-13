// Resolves the project's `@/…` tsconfig path alias for `node --test`, which
// otherwise has no idea what `@/lib/db` means. Node's type stripping handles the
// TypeScript itself; this only rewrites the specifier.
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import { dirname, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..")

/** Tries each extension in turn, returning the first that resolves. */
function resolveWithExtensions(basePath, context, nextResolve) {
  for (const candidate of [`${basePath}.ts`, `${basePath}.tsx`, `${basePath}/index.ts`]) {
    try {
      return nextResolve(pathToFileURL(candidate).href, context)
    } catch {
      // try the next candidate
    }
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      // Bare alias paths omit the extension; `types` is a directory with index.ts.
      const resolved = resolveWithExtensions(
        resolvePath(projectRoot, specifier.slice(2)),
        context,
        nextResolve
      )
      if (resolved) return resolved
    }

    // TypeScript source also imports siblings extensionlessly ("./auth"), which
    // ESM will not resolve on its own. Only applied when the specifier has no
    // extension, so real .js/.mjs/.json imports fall through untouched.
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.endsWith(".ts") &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      const resolved = resolveWithExtensions(
        resolvePath(dirname(fileURLToPath(context.parentURL)), specifier),
        context,
        nextResolve
      )
      if (resolved) return resolved
    }

    return nextResolve(specifier, context)
  },
})
