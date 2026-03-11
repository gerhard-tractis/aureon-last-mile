export const REMEMBER_ME_MAX_AGE = 2592000 // 30 days in seconds

export function getSetRememberMeCookie() {
    return `remember_me=1; path=/; max-age=${REMEMBER_ME_MAX_AGE}; SameSite=Strict`
}

export function getClearRememberMeCookie() {
    return 'remember_me=0; path=/; max-age=0; SameSite=Strict'
}
