import { BarcodeScanningResult, CameraView } from 'expo-camera';
import { StyleProp, ViewStyle } from 'react-native';

import {
  PROOF_CODE_BARCODE_TYPES,
  SCANNER_CAMERA_ZOOM,
  type ScannerBarcodeTypes,
} from '@/lib/scanner-camera';

type ProofCodeCameraProps = {
  barcodeTypes?: ScannerBarcodeTypes;
  enableTorch?: boolean;
  onBarcodeScanned?: (result: BarcodeScanningResult) => void;
  style?: StyleProp<ViewStyle>;
};

export function ProofCodeCamera({
  barcodeTypes = PROOF_CODE_BARCODE_TYPES,
  enableTorch = false,
  onBarcodeScanned,
  style,
}: ProofCodeCameraProps) {
  return (
    <CameraView
      barcodeScannerSettings={{ barcodeTypes }}
      enableTorch={enableTorch}
      facing="back"
      onBarcodeScanned={onBarcodeScanned}
      style={style}
      zoom={SCANNER_CAMERA_ZOOM}
    />
  );
}
