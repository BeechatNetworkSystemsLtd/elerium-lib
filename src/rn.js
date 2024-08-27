import {Platform} from 'react-native';
import NfcManager, {
    NfcTech,
    Nfc15693RequestFlagIOS,
} from 'react-native-nfc-manager';
import {TagError} from "./util.js";

async function iso15693Cmd(code, data, skipManufCode) {
    let res = null;

    let cmdHdr = [0x02, code, 0x04];

    if (skipManufCode) {
        cmdHdr = [0x02, code];
    }

    if (Platform.OS === 'android') {
        res = await NfcManager.transceive(cmdHdr.concat(data));
        res = res.slice(1);
    } else if (Platform.OS === 'ios') {
        res = await NfcManager.iso15693HandlerIOS.customCommand({
            flags: Nfc15693RequestFlagIOS.HighDataRate,
            customCommandCode: code,
            customRequestParameters: data,
        });
    } else {
        throw Error('Invalid platform OS.');
    }

    return res;
}

async function dqxPerformNFC(nfcAction, {setWorkStatusMessage}, options) {
    let result = null;

    let nfcTech = NfcTech.NfcV;

    if (Platform.OS === 'ios') {
        nfcTech = NfcTech.Iso15693IOS;
    }

    await NfcManager.requestTechnology(nfcTech, {
        alertMessage: 'Please tap the tag and hold it.',
    });

    let workingStatusTimeout = null;

    while (true) {
        let caughtEx = null;

        try {
            if (Platform.OS === 'ios') {
                workingStatusTimeout = setTimeout(() => {
                    NfcManager.setAlertMessageIOS('Working, please keep holding...');
                }, 250);
            }

            result = await nfcAction({setWorkStatusMessage, iso15693Cmd}, options);
        } catch (ex) {
            caughtEx = ex;
        }

        if (result === null) {
            if (caughtEx instanceof TagError) {
                // permanent error with the tag (for example: no key was generated)
                if (Platform.OS === 'ios') {
                    await NfcManager.invalidateSessionWithErrorIOS('Operation failed.');
                } else {
                    await NfcManager.cancelTechnologyRequest();
                }

                throw caughtEx;
            }

            console.log('Temporary error, trying again...', caughtEx);

            if (workingStatusTimeout) {
                clearTimeout(workingStatusTimeout);
                workingStatusTimeout = null;
            }

            if (Platform.OS === 'ios') {
                await NfcManager.setAlertMessageIOS('Lost connection with the tag, please try to hold it closer...');
                await NfcManager.restartTechnologyRequestIOS();
            } else {
                setWorkStatusMessage('TAP AGAIN');
                await NfcManager.cancelTechnologyRequest();
                await NfcManager.requestTechnology(nfcTech);
            }

            continue;
        }

        break;
    }

    if (Platform.OS === 'ios') {
        await NfcManager.setAlertMessageIOS('Done!');
    }

    await NfcManager.cancelTechnologyRequest();
    return result;
}

export {dqxPerformNFC};
