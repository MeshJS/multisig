import { Object3DNode } from "@react-three/fiber";
import ThreeGlobe from "three-globe";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      threeGlobe: Object3DNode<ThreeGlobe, typeof ThreeGlobe>;
      ambientLight: any;
      directionalLight: any;
      pointLight: any;
    }
  }
}

