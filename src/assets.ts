import { DataTexture } from 'three';
import { GLTF, GLTFLoader, RGBELoader } from 'three-stdlib';

export type GLTFAsset = {
  type: 'gltf';
  name: string;
  path: string;
};

export type RGBEAsset = {
  type: 'rgbe';
  name: string;
  path: string;
};

type Asset = GLTFAsset | RGBEAsset;

const assets: Asset[] = [
  {
    type: 'gltf',
    name: 'level1',
    path: 'level_1.glb',
  },
  {
    type: 'rgbe',
    name: 'hdr',
    path: 'industrial_sunset_puresky_2k.hdr',
  },
];

export type Assets = {
  dataTexture: Map<string, DataTexture>;
  gltf: Map<string, GLTF>;
};

export async function initAssets(): Promise<Assets> {
  return new Promise<Assets>((resolve) => {
    const resultAssets: Assets = {
      dataTexture: new Map(),
      gltf: new Map(),
    };

    const assetsToLoad = assets.length;
    let assetsLoaded = 0;

    const gltfLoader = new GLTFLoader();
    const rgbeLoader = new RGBELoader();

    function assetLoaded() {
      assetsLoaded++;

      if (assetsLoaded === assetsToLoad) {
        resolve(resultAssets);
      }
    }

    assets.forEach((asset) => {
      switch (asset.type) {
        case 'gltf':
          gltfLoader.loadAsync(asset.path).then((gltf) => {
            resultAssets.gltf.set(asset.name, gltf);
            assetLoaded();
          });
          break;
        case 'rgbe':
          rgbeLoader.loadAsync(asset.path).then((dataTexture) => {
            resultAssets.dataTexture.set(asset.name, dataTexture);
            assetLoaded();
          });
          break;
      }
    });
  });
}
