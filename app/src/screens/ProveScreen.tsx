import React, { useState, useEffect } from 'react';
import { YStack, XStack, Text, Spinner, useWindowDimensions } from 'tamagui';
import { CheckCircle } from '@tamagui/lucide-icons';
import { DEFAULT_MAJORITY, } from '../../../common/src/constants/constants';
import { bgGreen, separatorColor, textBlack } from '../utils/colors';
import useUserStore from '../stores/userStore';
import useNavigationStore from '../stores/navigationStore';
import { AppType } from '../../../common/src/utils/appType';
import CustomButton from '../components/CustomButton';
import { generateCircuitInputsProve } from '../../../common/src/utils/generateInputs';
import { revealBitmapFromAttributes } from '../../../common/src/utils/revealBitmap';
import { formatProof, generateProof } from '../utils/prover';
import io, { Socket } from 'socket.io-client';

interface ProveScreenProps {
  setSheetRegisterIsOpen: (value: boolean) => void;
}

const ProveScreen: React.FC<ProveScreenProps> = ({ setSheetRegisterIsOpen }) => {
  const [generatingProof, setGeneratingProof] = useState(false);
  const selectedApp = useNavigationStore(state => state.selectedApp) as AppType;
  const {
    toast,
    setSelectedTab
  } = useNavigationStore()

  const {
    setProofVerificationResult
  } = useUserStore()

  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const waitForSocketConnection = (socket: Socket): Promise<void> => {
    return new Promise((resolve) => {
      if (socket.connected) {
        resolve();
      } else {
        socket.once('connect', () => {
          resolve();
        });
      }
    });
  };

  useEffect(() => {
    const newSocket = io('https://proofofpassport-merkle-tree.xyz', {
      path: '/websocket',
      transports: ['websocket'],
      query: { sessionId: selectedApp.userId, clientType: 'mobile' }
    });

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    newSocket.on('proof_verification_result', (result) => {
      console.log('Proof verification result:', result);
      setProofVerificationResult(JSON.parse(result));
      console.log("result", result);
      setSelectedTab(JSON.parse(result).valid ? "valid" : "wrong");
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [selectedApp.userId]);

  const handleProve = async () => {
    try {
      setIsConnecting(true);
      setGeneratingProof(true);

      if (!socket) {
        throw new Error('Socket not initialized');
      }

      await waitForSocketConnection(socket);

      setIsConnecting(false);
      socket.emit('proof_generation_start', { sessionId: selectedApp.userId });
      const inputs = generateCircuitInputsProve(
        passportData,
        64, 32,
        selectedApp.scope,
        revealBitmapFromAttributes(selectedApp.disclosureOptions as any),
        (selectedApp.disclosureOptions && selectedApp.disclosureOptions.older_than) ? selectedApp.disclosureOptions.older_than : DEFAULT_MAJORITY,
        selectedApp.userId
      );

      const rawDscProof = await generateProof(
        selectedApp.circuit,
        inputs,
      );
      const dscProof = formatProof(rawDscProof);
      // Send the proof via WebSocket
      const response = {
        dsc: passportData.dsc,
        dscProof: dscProof
      };

      console.log("response", response);

      socket.emit('proof_generated', { sessionId: selectedApp.userId, proof: response });

    } catch (error) {
      console.error('Error in handleProve:', error);
    } finally {
      setGeneratingProof(false);
      setIsConnecting(false);
    }
  };

  const {
    registered,
    passportData,
  } = useUserStore();


  const disclosureFieldsToText = (key: string, value: string = "") => {
    if (key === 'older_than') {
      return `I am older than ${value} years old.`;
    }
    if (key === 'nationality') {
      return `I have a valid passport from ${value}.`;
    }
    return '';
  }

  return (
    <YStack f={1} p="$3">
      {Object.keys(selectedApp.disclosureOptions as any).length > 0 ? <YStack mt="$4">
        <Text fontSize="$9">
          <Text fow="bold" style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>{selectedApp.name}</Text> is requesting you to prove the following information.
        </Text>
        <Text mt="$3" fontSize="$8" color={textBlack} style={{ opacity: 0.9 }}>
          No <Text style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>other</Text> information than the one selected below will be shared with {selectedApp.name}.
        </Text>
      </YStack> :
        <Text fontSize="$9">
          <Text fow="bold" style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>{selectedApp.name}</Text> is requesting you to prove you own a valid passport.
        </Text>
      }

      <YStack mt="$6">
        {selectedApp && Object.keys(selectedApp.disclosureOptions as any).map((key) => {
          return (
            <XStack key={key} gap="$3" mb="$3" ml="$3" >
              <CheckCircle size={16} mt="$1.5" />
              <Text fontSize="$7" color={textBlack} w="85%">
                {disclosureFieldsToText(key, (selectedApp.disclosureOptions as any)[key])}
              </Text>
            </XStack>
          );
        })}
      </YStack>

      <XStack f={1} />

      <CustomButton
        Icon={isConnecting ? <Spinner /> : generatingProof ? <Spinner /> : <CheckCircle />}
        isDisabled={isConnecting || generatingProof}
        text={isConnecting ? "Connecting..." : generatingProof ? "Generating Proof..." : "Verify"}
        onPress={registered ? handleProve : () => setSheetRegisterIsOpen(true)}
        bgColor={isConnecting || generatingProof ? separatorColor : bgGreen}
        disabledOnPress={() => toast.show('⏳', {
          message: isConnecting ? "Connecting to server..." : "Proof is generating",
          customData: {
            type: "info",
          },
        })}
      />

    </YStack >
  );
};

export default ProveScreen;