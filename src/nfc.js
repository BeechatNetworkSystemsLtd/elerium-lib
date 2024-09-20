import { Platform } from 'react-native';

import NfcManager, {
    NfcTech,
    Nfc15693RequestFlagIOS,
} from 'react-native-nfc-manager';

import CRC32 from 'crc-32';

import { Timeout, bytesToHex } from './util.js'

const SRAM_SIZE = 256;
const HEADER_SIZE = 4 + 4;
const MAX_MESSAGE_SIZE = SRAM_SIZE - HEADER_SIZE;

async function transceive(code, data) {

    const flags = Nfc15693RequestFlagIOS.HighDataRate;

    let result = null;
    switch(Platform.OS) {
        case 'android':
            const command = [flags, code, 0x04];
            result = await NfcManager.transceive(command.concat(data));
            result = result.slice(1);
            break;
        case 'ios':
            result = await NfcManager.iso15693HandlerIOS.customCommand({
                flags: flags,
                customCommandCode: code,
                customRequestParameters: data,
            });
            break;
        default:
            throw Error('Invalid platform OS.');
    } 

    return result;
}

async function performTransaction(transaction) {
    let result = null;

    try {
        console.log("elerium: request nfc");

        const nfcTech = (Platform.OS === 'ios') ? NfcTech.Iso15693IOS : NfcTech.NfcV;
        await NfcManager.requestTechnology(nfcTech, {
            alertMessage: 'Please tap the tag and hold it.',
        });

        // wait for base config
        await waitForConfig(0x00A1, 0x00000F00, 0x00000B00, 3000);

        // waif for nfc unlock
        await waitForConfig(0x00A0, 0x00000300, 0x00000100, 3000);

        await transaction();

      } catch (e) {
        console.warn('elerium:', e, JSON.stringify(e));
      } finally {
        console.log("elerium: stop nfc");
        await NfcManager.cancelTechnologyRequest();
    }

    return result;
}


// arbiter mode = pass through, SRAM is accessible, transfer dir = nfc
async function waitForConfig(address, mask, value, interval) {
  const timeout = new Timeout();

  while (!timeout.elapsed(interval)) {

    try {
      const result = await transceive(0xC0, [address & 0xFF, (address >> 8) & 0xFF]);

      const config = (result[0] << 0) | (result[1] << 8) | (result[2] << 16) | (result[3] << 24);
      console.log('config', config.toString(16));

      if ((config & mask) === value) {
        console.log('elerium: config ready');
        return;
      }
    } catch (e) {
      console.log('elerium:', e);
    }

    await Timeout.sleep(15);
  }

  throw Error("wait for config timed out");
}

async function writeMessage(message) {

    if (!message) {
        throw Error("invalid message");
    }

    if (message.length > MAX_MESSAGE_SIZE) {
        throw Error("message to large");
    }

    const crc = CRC.buf(message, 0);

}

class EleriumNfc {

    constructor() {

    }

    async createWallet() {

    }

    async testCommand() {

        return writeMessage([0x00, 0xA0]);

        return performTransaction(async () => {



        });
    }
};

export {
    EleriumNfc
};
