import React, { useState, useEffect } from 'react';
import { YStack, XStack, Text, Checkbox, Input, Button, Spinner, Image, useWindowDimensions, ScrollView, Fieldset } from 'tamagui';
import { Check, Plus, Minus, PenTool, ShieldCheck } from '@tamagui/lucide-icons';
import { getFirstName, maskString } from '../../utils/utils';
import { attributeToPosition, COMMITMENT_TREE_TRACKER_URL } from '../../../common/src/constants/constants';
import USER from '../images/user.png'
import { bgGreen, borderColor, componentBgColor, componentBgColor2, separatorColor, textBlack, textColor1, textColor2 } from '../utils/colors';
import { ethers } from 'ethers';
import { Platform } from 'react-native';
import { formatAttribute, Steps } from '../utils/utils';
import { downloadZkey } from '../utils/zkeyDownload';
import useUserStore from '../stores/userStore';
import useNavigationStore from '../stores/navigationStore';
import { AppType } from '../../../common/src/utils/appType';
import useSbtStore from '../stores/sbtStore';
import CustomButton from '../components/CustomButton';
import { generateCircuitInputsDisclose } from '../../../common/src/utils/generateInputs';
import { PASSPORT_ATTESTATION_ID, RPC_URL, SignatureAlgorithm } from '../../../common/src/constants/constants';
import axios from 'axios';
//import { getTreeFromTracker } from '../../../common/src/utils/commitmentTree';
import { stringToNumber } from '../../../common/src/utils/utils';
import { revealBitmapFromAttributes } from '../../../common/src/utils/revealBitmap';
import { getTreeFromTracker } from '../../../common/src/utils/pubkeyTree';
import { generateProof } from '../utils/prover';
interface ProveScreenProps {
  setSheetRegisterIsOpen: (value: boolean) => void;
}

const ProveScreen: React.FC<ProveScreenProps> = ({ setSheetRegisterIsOpen }) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [requestingMerkle, setRequestingMerkle] = useState(false);
  const selectedApp = useNavigationStore(state => state.selectedApp) as AppType;
  const {
    hideData,
    isZkeyDownloading,
    step,
    toast
  } = useNavigationStore()

  const {
    secret,
  } = useUserStore()

  // const {
  //   fields,
  //   handleProve,
  //   circuit,
  // } = selectedAp
  const handleProve = async () => {
    console.log("handleProve");

    const tree = await getTreeFromTracker(setRequestingMerkle);

    const base_majority = [BigInt(1).toString(), BigInt(8).toString()];
    const majority = (selectedApp.disclosureOptions?.older_than ? Array.from(selectedApp.disclosureOptions.older_than).map(char => {
      try {
        return BigInt(char).toString();
      } catch (error) {
        console.error(`Failed to convert ${char} to BigInt:`, error);
        return null; // or handle the error as needed
      }
    }).filter(char => char !== null) : base_majority);

    const inputs = generateCircuitInputsDisclose(
      secret,
      PASSPORT_ATTESTATION_ID,
      passportData,
      tree as any,
      [BigInt(49).toString(), BigInt(50).toString()],
      revealBitmapFromAttributes(selectedApp.disclosureOptions as any),
      selectedApp.scope,
      stringToNumber(selectedApp.userId).toString()

    )
    console.log("inputs", inputs);
    const proof = await generateProof(
      selectedApp.circuit,
      inputs,
    );
    toast.show('🔥', {
      message: JSON.stringify(proof),
      customData: {

        type: "info",
      },
    });


  }

  // const {
  //   address,
  //   majority,
  //   disclosure,
  //   update
  // } = useAppStore();

  const {
    registered,
    passportData,
  } = useUserStore();

  const handleDisclosureChange = (field: string) => {
    const requiredOrOptional = selectedApp.disclosureOptions[field as keyof typeof selectedApp.disclosureOptions];
    if (requiredOrOptional === 'required') {
      return;
    }
    // update({
    //   disclosure: {
    //     ...disclosure,
    //     [field]: !disclosure[field as keyof typeof disclosure]
    //   }
    // });
  };
  const handleAcknoledge = () => {
    setAcknowledged(!acknowledged);
  }
  const { height } = useWindowDimensions();

  useEffect(() => {
    // this already checks if downloading is required
    // downloadZkey(circuit);
  }, [])

  const disclosureFieldsToText = (key: string, value: string = "") => {
    if (key === 'older_than') {
      return `I am older than ${value} years old.`;
    }
    if (key === 'nationality') {
      return `I got a valid passport from ${value}.`;
    }
    return '';
  }

  return (
    <YStack f={1} p="$3">

      <YStack mt="$4">
        <Text fontSize="$9">
          <Text fow="bold" style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>{selectedApp.name}</Text> is requesting you to prove the following information.
        </Text>
        <Text mt="$3" fontSize="$8" color={textBlack} >

          No <Text style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>other</Text> information than the one selected below will be shared with {selectedApp.name}.
        </Text>
      </YStack>

      {/* <Text mt="$8" fontSize="$8" color={textBlack}>
        I want to prove that:
      </Text> */}
      <YStack mt="$6">


        {selectedApp && Object.keys(selectedApp.disclosureOptions as any).map((key) => {
          const key_ = key;
          const indexes = attributeToPosition[key_ as keyof typeof attributeToPosition];
          const keyFormatted = key_.replace(/_/g, ' ').split(' ').map((word: string) => word.charAt(0) + word.slice(1)).join(' ');
          const mrzAttribute = passportData.mrz.slice(indexes[0], indexes[1] + 1);
          const mrzAttributeFormatted = formatAttribute(key_, mrzAttribute);

          return (
            <XStack key={key} gap="$3" alignItems='center'>

              <Fieldset gap="$2.5" horizontal>
                <XStack p="$2" onPress={() => handleDisclosureChange(key_)} >
                  <Checkbox
                    borderColor={separatorColor}
                    value={key}
                    onCheckedChange={() => handleDisclosureChange(key_)}
                    aria-label={keyFormatted}
                    size="$6"
                  >
                    <Checkbox.Indicator >
                      <Check color={textBlack} />
                    </Checkbox.Indicator>
                  </Checkbox>
                </XStack>
                {key_ === 'older_than' ? (
                  <XStack gap="$1.5" jc='center' ai='center'>
                    <XStack mr="$2">
                      {/* <Text color={textColor1} w="$1" fontSize={16}>{majority}</Text> */}
                      <Text color={textBlack} fontSize="$6">{disclosureFieldsToText('older_than', (selectedApp.disclosureOptions as any).older_than)}</Text>
                    </XStack>
                  </XStack>
                ) : (
                  <Text fontSize="$6"
                    color={textBlack}
                  >
                    {disclosureFieldsToText(keyFormatted, mrzAttributeFormatted)}
                  </Text>
                )}
              </Fieldset>


            </XStack>
          );
        })}
      </YStack>


      <XStack f={1} />
      {selectedApp && Object.keys(selectedApp as any).map((key) => {
        const value = selectedApp[key as keyof AppType];
        return (
          <Text key={key} fontSize="$6" color={textBlack}>
            {`${key}: ${value}`}
          </Text>
        );
      })}
      <XStack f={1} />



      <XStack ai="center" gap="$2" mb="$2.5" ml="$2">
        <XStack onPress={handleAcknoledge} p="$2">
          <Checkbox size="$6" checked={acknowledged} onCheckedChange={handleAcknoledge} borderColor={separatorColor}>
            <Checkbox.Indicator>
              <Check color={textBlack} />
            </Checkbox.Indicator>
          </Checkbox>
        </XStack>
        <Text style={{ fontStyle: 'italic' }} w="85%">I acknowledge sharing the selected information with {selectedApp.name}</Text>
      </XStack>



      <CustomButton isDisabled={!acknowledged} text={requestingMerkle ? "Requesting Merkle Tree..." : "Prove"} onPress={registered ? handleProve : () => setSheetRegisterIsOpen(true)} bgColor={acknowledged ? bgGreen : separatorColor} disabledOnPress={() => toast.show('✍️', {
        message: "Please check all fields",
        customData: {
          type: "info",
        },
      })} />


    </YStack >
  );
};

export default ProveScreen;