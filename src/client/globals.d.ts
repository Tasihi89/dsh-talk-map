/** css imports are handled by the dsh-css-inline tsdown plugin at build time. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'
