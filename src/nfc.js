import { Platform } from "react-native";

import NfcManager, {
  NfcTech,
  Nfc15693RequestFlagIOS,
} from "react-native-nfc-manager";

import CRC32 from "crc-32";

import { Timeout, bytesToHex, hexToBytes } from "./util.js";
import { Buffer } from "buffer";

/*****************************************************************************/

const SRAM_SIZE = 256;
const BLOCK_SIZE = 4;
const HEADER_SIZE = 4 + 4;
const MAX_MESSAGE_SIZE = SRAM_SIZE - HEADER_SIZE;
const MAGIC_PATTERN = [0xe1, 0xed];

/*****************************************************************************/

async function transceive(code, data) {
  const flags = Nfc15693RequestFlagIOS.HighDataRate;

  let result = null;
  switch (Platform.OS) {
    case "android":
      const command = [flags, code, 0x04];
      result = await NfcManager.transceive(command.concat(data));
      result = result.slice(1);
      break;
    case "ios":
      result = await NfcManager.iso15693HandlerIOS.customCommand({
        flags: flags,
        customCommandCode: code,
        customRequestParameters: data,
      });
      break;
    default:
      throw Error("Invalid platform OS.");
  }

  // console.log("trx", "out", data, "in", result);

  return result;
}

async function performTransaction(transaction) {
  let result = null;

  try {
    console.log("elerium: request nfc");

    const nfcTech = Platform.OS === "ios" ? NfcTech.Iso15693IOS : NfcTech.NfcV;
    await NfcManager.requestTechnology(nfcTech, {
      alertMessage: "Please tap the tag and hold it.",
    });

    console.log("elerium:", "enable ed-pin for sram");
    await transceive(0xc1, [0xa8, 0x04, 0x00, 0x00, 0x00]);

    await Timeout.sleep(200);

    console.log("elerium:", "wait for base config");
    await waitForConfig(0x00a1, 0x00000f00, 0x00000b00, 3000);

    console.log("elerium:", "wait for unlock");
    await waitUnlock(30000);

    console.log("elerium:", "execute transaction");
    result = await transaction();

    console.log("elerium:", "enable ed-pin for ndef");
    await transceive(0xc1, [0xa8, 0x09, 0x00, 0x00, 0x00]);

    await Timeout.sleep(100);
  } catch (e) {
    console.warn("elerium:", "error -", e, JSON.stringify(e));
    throw e;
  } finally {
    console.log("elerium: stop nfc");
    await NfcManager.cancelTechnologyRequest();
  }

  return result;
}

/*****************************************************************************/

async function waitForConfig(address, mask, value, interval) {
  const timeout = new Timeout();

  while (!timeout.elapsed(interval)) {
    try {
      const result = await transceive(0xc0, [
        (address >> 0) & 0xff,
        (address >> 8) & 0xff,
      ]);

      const config =
        (result[0] << 0) |
        (result[1] << 8) |
        (result[2] << 16) |
        (result[3] << 24);

      if ((config & mask) === value) {
        return;
      }
    } catch (e) {
      console.log("elerium:", e);
    }

    await Timeout.sleep(50);
  }

  throw Error("wait for config timed out");
}

async function waitUnlock(interval) {
  return await waitForConfig(0x00a0, 0x00000300, 0x00000100, interval);
}

/*****************************************************************************/

async function writeMessage(message) {
  if (!message) {
    throw Error("invalid message");
  }

  if (message.length > MAX_MESSAGE_SIZE || message.length > 0xff) {
    throw Error("message to large");
  }

  const crc = CRC32.buf(message, 0);

  const data = (() => {
    if (message.length % BLOCK_SIZE !== 0) {
      const pad = Array(BLOCK_SIZE - (message.length % BLOCK_SIZE));
      pad.fill(0);
      return message.concat(pad);
    } else {
      return message;
    }
  })();

  // uint32 - 4 bytes
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeInt32LE(crc, 0);

  const payload = MAGIC_PATTERN.concat([0x00, message.length])
    .concat([...crcBuffer])
    .concat(data);

  const pages = payload.length / BLOCK_SIZE - 1;

  await transceive(0xd3, [0x00, pages].concat(payload));

  // Control to NFC Tag
  await transceive(0xd3, [0x3f, 0x00, 0xff, 0xff, 0xff, 0xff]);
}

async function readMessage(timeout) {
  await waitUnlock(timeout || 30000);

  const response = await transceive(0xd2, [0x00, 0x01]);
  const responseBuffer = Buffer.from(response);

  for (let i in MAGIC_PATTERN) {
    if (response[i] != MAGIC_PATTERN[i]) {
      throw Error("Magic not found");
    }
  }

  const status = response[2];
  const length = response[3];
  if (length > MAX_MESSAGE_SIZE) {
    throw Error("Payload more then maximum");
  }

  const expectedCrcBuffer = Buffer.from(response.slice(4));

  const message = await (async () => {
    if (length > 0) {
      let pages = (length & ~3) / BLOCK_SIZE - 1;

      if (pages % BLOCK_SIZE !== 0) {
        pages++;
      }

      return (await transceive(0xd2, [0x02, pages])).slice(0, length);
    } else {
      return [];
    }
  })();

  const actualCrcBuffer = Buffer.alloc(4);
  actualCrcBuffer.writeInt32LE(CRC32.buf(message), 0);

  if (actualCrcBuffer.compare(expectedCrcBuffer) !== 0) {
    throw Error("CRC mismatch");
  }

  if (status & (0x01 << 1)) {
    throw Error("elerium message request failed");
  }

  if (status & (0x01 << 0)) {
    return message;
  }

  throw Error("elerium message request wasn't handled");
}

/*****************************************************************************/

/**
 * @brief Program Elerium NFC with new password and URL
 *
 * @param password User password (should be 8 symbols in length)
 * @param url Pre-URL
 *
 * @return Public Key in bytes [0x00, 0x00, .., 0x00] (64 len)
 */
async function urlSignProgram(password, url) {
  if (password.length != 8) {
    throw Error("password should be exact 8 symbols");
  }

  return await performTransaction(async () => {
    const request = [0xb0, 0x00, 0x00, 0x00]
      .concat([...Buffer.from(password)])
      .concat([...Buffer.from(url)]);

    await writeMessage(request);

    const message = await readMessage();

    const public_key = message;
    console.log(
      "elerium: url-sign pub key",
      "len(",
      public_key.length,
      ")",
      Buffer.from(public_key).toString("hex"),
    );
    return public_key;
  });
}

/**
 * @brief Get Public-Key of Elerium NFC
 *
 * @return Public Key in bytes [0x00, 0x00, .., 0x00] (64 len)
 */
async function urlSignGetPublicKey() {
  return await performTransaction(async () => {
    const request = [0xb1, 0x00, 0x00, 0x00];

    await writeMessage(request);

    const message = await readMessage();

    return message;
  });
}

/**
 * @brief Reset Elerium NFC
 *
 * @param password User password (should be 8 symbols in length)
 */
async function urlSignReset(password) {
  if (password.length != 8) {
    throw Error("password should be exact 8 symbols");
  }

  return await performTransaction(async () => {
    const request = [0xb2, 0x00, 0x00, 0x00].concat([...Buffer.from(password)]);

    await writeMessage(request);

    const message = await readMessage();
  });
}

/*****************************************************************************/

export { urlSignProgram, urlSignGetPublicKey, urlSignReset };
