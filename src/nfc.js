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

    console.log("elerium:", "wait for base config");

    await waitForConfig(0x00a1, 0x00000f00, 0x00000b00, 3000);

    console.log("elerium:", "wait for unlock");
    await waitUnlock(12000);

    console.log("elerium:", "execute transaction");
    result = await transaction();
  } catch (e) {
    console.warn("elerium:", e, JSON.stringify(e));
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
  await waitUnlock(timeout || 10000);

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

  return message;
}

/*****************************************************************************/

class EleriumNfc {
  constructor() {}

  /**
   *
   * @param secret Passcode in byte-array (ex: [0x11, 0x11])
   *
   * @return wallet info
   */
  async createWallet(secret) {}

  /**
   * @param id Wallet Id
   * @param secret Passcode in byte-array (ex: [0x11, 0x11])
   * @param hash Hash to be signed
   *
   * @return signature as byte-array
   */
  async singTransaction(id, secret, hash) {}

  /**
   */
  async wallets() {}

  async destroyWallet(id) {}

  async writeMessage(message) {
    return await writeMessage(message);
  }

  async readMessage() {
    return await readMessage();
  }

  async execute(transaction) {
    return await performTransaction(async () => {
      return await transaction(writeMessage, readMessage);
    });
  }

  async testCommand() {
    return await performTransaction(async () => {
      await writeMessage(hexToBytes("AABBCCDD1122334455667788"));
      let message = await readMessage();
      console.log(bytesToHex(message));
    });
  }
}

/*****************************************************************************/

export { EleriumNfc };
