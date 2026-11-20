// Which link targets "Keep web links" may keep: web and mail only. Browsers ignore whitespace and control characters inside a scheme
// ("java\nscript:"), so those are removed before testing; anything else (javascript:, file:, data:, relative targets) is not kept.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
export const isSafeLink = (uri: string | undefined): boolean => /^(https?|mailto):/i.test((uri ?? "").replace(/[\u0000- \u007f-\u009f]/g, ""));
