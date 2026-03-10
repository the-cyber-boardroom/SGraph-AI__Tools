/* =============================================================================
   SGraph — Word List Module
   v1.0.0 — Word lists for friendly key generation

   Provides curated word lists for generating human-friendly encryption keys.
   Words are common, short, easy to spell, and easy to communicate verbally.

   Usage:
     import { getWordList, getRandomWords, searchWords, SUPPORTED_LOCALES } from './sg-wordlist.js';

     const words   = await getWordList('en-gb');       // ~2000 words
     const random  = await getRandomWords(2, 'en-gb'); // ["apple", "mango"]
     const matches = await searchWords('app', 'en-gb'); // ["apple", "apply", ...]
   ============================================================================= */

/** @type {Map<string, string[]>} In-memory cache of loaded word lists */
const cache = new Map()

/** @type {string[]} Locales with word lists available */
export const SUPPORTED_LOCALES = ['en-gb']

/**
 * Load word list for a locale. Caches after first load.
 *
 * @param {string} [locale='en-gb'] - Locale code
 * @returns {Promise<string[]>} Array of words (lowercase, sorted)
 */
export async function getWordList(locale = 'en-gb') {
    if (cache.has(locale)) return cache.get(locale)

    const url = new URL(`wordlists/${locale}.json`, import.meta.url)
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Word list not found for locale: ${locale}`)
    }
    const words = await response.json()
    cache.set(locale, words)
    return words
}

/**
 * Get N random words from the word list.
 * Uses crypto.getRandomValues() for unbiased selection.
 *
 * @param {number} [count=2] - Number of words
 * @param {string} [locale='en-gb'] - Locale code
 * @returns {Promise<string[]>} Array of random words
 */
export async function getRandomWords(count = 2, locale = 'en-gb') {
    const words = await getWordList(locale)
    const result = []
    for (let i = 0; i < count; i++) {
        const index = secureRandomIndex(words.length)
        result.push(words[index])
    }
    return result
}

/**
 * Search word list for auto-complete matches.
 *
 * @param {string} prefix - Partial word typed by user
 * @param {string} [locale='en-gb'] - Locale code
 * @param {number} [maxResults=10] - Max suggestions
 * @returns {Promise<string[]>} Matching words
 */
export async function searchWords(prefix, locale = 'en-gb', maxResults = 10) {
    const words = await getWordList(locale)
    const lower = prefix.toLowerCase()
    return words.filter(w => w.startsWith(lower)).slice(0, maxResults)
}

/**
 * Generate a cryptographically secure random index.
 *
 * @param {number} max - Upper bound (exclusive)
 * @returns {number} Random index in [0, max)
 */
function secureRandomIndex(max) {
    const array = new Uint32Array(1)
    crypto.getRandomValues(array)
    return array[0] % max
}
