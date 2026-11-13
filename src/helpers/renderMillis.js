// Cut points in seconds. Math.round keeps millisecond precision.
// Number#toPrecision(4) does not: it keeps four significant digits, so a cut past 100s moves by 0.1s.
export function secondsBetween(laterMs, earlierMs) {
    return Math.round(Math.abs(laterMs - earlierMs)) / 1000
}
