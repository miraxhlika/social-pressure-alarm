import { type ComponentProps } from 'react';
import { type CameraView } from 'expo-camera';

export type ScannerBarcodeTypes = NonNullable<
  NonNullable<ComponentProps<typeof CameraView>['barcodeScannerSettings']>['barcodeTypes']
>;

export const QR_BARCODE_TYPES: ScannerBarcodeTypes = ['qr'];

export const PROOF_CODE_BARCODE_TYPES: ScannerBarcodeTypes = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code39',
  'code93',
  'code128',
  'codabar',
  'itf14',
  'pdf417',
  'aztec',
  'datamatrix',
];

/**
 * expo-camera maps zoom exponentially (`maxZoom ** value`), not as a native
 * videoZoomFactor. ~0.12 lands near 1.5–2x on current iPhones, which is past
 * the wide camera's minimum focus distance so close barcodes can lock.
 *
 * @see https://developer.apple.com/videos/play/wwdc2021/10047/
 */
export const SCANNER_CAMERA_ZOOM = 0.12;

export const SCANNER_DISTANCE_HINT =
  "Keep the phone about a hand's length away, then move in slowly.";
