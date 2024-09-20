function hexToBytes(hex) {
  let bytes, c;
  for (bytes = [], c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substr(c, 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes) {
  let hex, i;
  for (hex = [], i = 0; i < bytes.length; i++) {
    let current = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    // eslint-disable-next-line no-bitwise
    hex.push((current >>> 4).toString(16));
    hex.push((current & 0xf).toString(16));
  }
  return hex.join("");
}

class Timeout {
  constructor() {
    this.startTime = Timeout.currentTime();
  }

  elapsed(interval) {
    return Timeout.currentTime() - this.startTime >= interval;
  }

  reset() {
    this.startTime = Timeout.currentTime();
  }

  static sleep(interval) {
    return new Promise((resolve) => {
      setTimeout(resolve, interval);
    });
  }

  static currentTime() {
    return new Date().getTime();
  }
}

export { Timeout, hexToBytes, bytesToHex };
