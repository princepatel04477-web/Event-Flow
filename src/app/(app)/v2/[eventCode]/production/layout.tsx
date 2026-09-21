// Legacy route, served under the new shell until its own session converts it.
// The v1 group is untouched; this is a re-export, not a copy.
//
// Both lines are required: `export *` does not carry the default export, and
// the default export is the screen. `export *` DOES carry the named extras -
// `metadata`, `generateMetadata`, `dynamic` - which is what we want.
export * from '@/app/(staff)/[eventCode]/production/layout'
export { default } from '@/app/(staff)/[eventCode]/production/layout'