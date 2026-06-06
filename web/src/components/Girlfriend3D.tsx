import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Emotion } from "../services/api";

interface Girlfriend3DProps {
  emotion: Emotion;
  speaking: boolean;
}

interface EmotionBlend {
  smile: number;
  eyeOpen: number;
  browTilt: number;
  headLift: number;
  chestBounce: number;
}

const EMOTION_PRESET: Record<Emotion, EmotionBlend> = {
  happy: { smile: 1.15, eyeOpen: 1, browTilt: -0.18, headLift: 0.02, chestBounce: 0.03 },
  sad: { smile: 0.65, eyeOpen: 0.8, browTilt: 0.14, headLift: -0.06, chestBounce: -0.01 },
  surprise: { smile: 0.85, eyeOpen: 1.1, browTilt: -0.24, headLift: 0.08, chestBounce: 0.07 },
  wink: { smile: 0.78, eyeOpen: 0.45, browTilt: -0.1, headLift: 0.03, chestBounce: 0.05 },
  neutral: { smile: 1, eyeOpen: 0.9, browTilt: 0, headLift: 0, chestBounce: 0 },
  angry: { smile: 0.65, eyeOpen: 0.72, browTilt: 0.22, headLift: -0.02, chestBounce: 0.01 },
  love: { smile: 1.3, eyeOpen: 1.05, browTilt: -0.12, headLift: 0.03, chestBounce: 0.04 }
};

function GirlBody({ emotion, speaking }: { emotion: Emotion; speaking: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const leftPupilRef = useRef<THREE.Mesh>(null);
  const rightPupilRef = useRef<THREE.Mesh>(null);
  const chestRef = useRef<THREE.Mesh>(null);

  const blinkCycle = useRef(0);
  const blinkState = useRef(1);
  const materials = useMemo(() => {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe4a8b6 });
    const jacket = new THREE.MeshStandardMaterial({ color: 0x1f2944 });
    const face = new THREE.MeshStandardMaterial({ color: 0xefc4bb });
    const hair = new THREE.MeshStandardMaterial({ color: 0x5f3a2b });
    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const eyeIris = new THREE.MeshStandardMaterial({ color: 0x1f1f2c });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
    const mouth = new THREE.MeshStandardMaterial({ color: 0x5a2a3f });
    const arm = new THREE.MeshStandardMaterial({ color: 0xb58ea3 });
    return { skin, jacket, face, hair, eyeWhite, eyeIris, pupil, mouth, arm };
  }, []);

  const preset = useMemo(() => EMOTION_PRESET[emotion], [emotion]);
  const eyeTarget = useRef({ left: preset.eyeOpen, right: preset.eyeOpen });
  const smileTarget = useRef(preset.smile);
  const browTarget = useRef(preset.browTilt);
  const chestTarget = useRef(preset.chestBounce);

  useFrame((state, delta) => {
    if (!groupRef.current || !mouthRef.current || !leftEyeRef.current || !rightEyeRef.current || !headRef.current || !chestRef.current) {
      return;
    }

    const wave = Math.sin(state.clock.getElapsedTime() * 2);
    const current = EMOTION_PRESET[emotion];
    eyeTarget.current = {
      left: current.eyeOpen + Math.abs(wave) * 0.02,
      right: current.eyeOpen + Math.abs(wave) * 0.02
    };
    smileTarget.current = current.smile;
    browTarget.current = current.browTilt;
    chestTarget.current = current.chestBounce;

    blinkCycle.current += delta;
    const shouldBlink = blinkCycle.current > 4;
    if (shouldBlink && Math.random() > 0.96) {
      blinkCycle.current = 0;
      blinkState.current = 0.08;
    }
    blinkState.current = Math.max(0.09, blinkState.current + delta * 4);
    if (blinkState.current > 1) blinkState.current = 1;

    const speakingPulse = speaking ? (Math.sin(state.clock.getElapsedTime() * 18) + 1) / 24 : 0;

    const targetMouthOpen = Math.max(0.05, (speaking ? 0.22 : 0.15) + speakingPulse);
    mouthRef.current.scale.set(1.6 * smileTarget.current, 1, 1);
    mouthRef.current.scale.y = targetMouthOpen;
    mouthRef.current.rotation.z = -0.18 + (smileTarget.current - 1) * 0.18;

    const targetEye = speaking ? eyeTarget.current.left * 0.88 : eyeTarget.current.left;
    leftEyeRef.current.scale.y = Math.max(0.05, targetEye * blinkState.current);
    rightEyeRef.current.scale.y = Math.max(0.05, eyeTarget.current.right * blinkState.current);

    const driftX = Math.sin(state.clock.getElapsedTime() * 0.9) * 0.015;
    const driftY = Math.cos(state.clock.getElapsedTime() * 0.85) * 0.005;
    leftEyeRef.current.position.x = -0.16 + driftX;
    rightEyeRef.current.position.x = 0.16 + driftX;
    leftEyeRef.current.position.y = 0.03 + driftY;
    rightEyeRef.current.position.y = 0.03 + driftY;

    if (leftPupilRef.current) leftPupilRef.current.position.x = Math.sin(state.clock.getElapsedTime() * 1.8) * 0.012;
    if (rightPupilRef.current) rightPupilRef.current.position.x = Math.sin(state.clock.getElapsedTime() * 1.8 + 0.6) * 0.012;

    groupRef.current.rotation.y = Math.sin(state.clock.getElapsedTime() * 0.6) * 0.12;
    groupRef.current.rotation.x = browTarget.current * 0.35 + (speaking ? -0.06 : 0);
    headRef.current.rotation.x = browTarget.current * 0.6;
    headRef.current.position.y = 1.3 + current.headLift + (speaking ? 0.025 : 0);
    chestRef.current.position.y = -0.05 + chestTarget.current * (speaking ? 1.2 : 1) + Math.sin(state.clock.getElapsedTime() * 8) * 0.01;
  });

  return (
    <group ref={groupRef} position={[0, -0.6, 0]}>
      <mesh ref={chestRef} position={[0, 0.85, 0]} material={materials.skin}>
        <boxGeometry args={[1.15, 0.8, 0.45]} />
      </mesh>

      <mesh position={[0, 1.22, 0.06]} castShadow material={materials.jacket}>
        <boxGeometry args={[0.24, 0.28, 0.18]} />
      </mesh>

      <mesh ref={headRef} position={[0, 1.58, 0]} castShadow material={materials.face}>
        <sphereGeometry args={[0.35, 32, 32]} />
      </mesh>

      <mesh position={[0, 1.9, -0.13]} rotation={[-0.9, 0, 0]} material={materials.hair}>
        <torusGeometry args={[0.38, 0.1, 12, 20]} />
      </mesh>

      <mesh ref={leftEyeRef} position={[-0.14, 1.55, 0.31]} material={materials.eyeWhite}>
        <sphereGeometry args={[0.08, 16, 16]} />
      </mesh>
      <mesh position={[-0.14, 1.55, 0.31]} scale={[0.6, 1, 0.6]} material={materials.eyeIris}>
        <sphereGeometry args={[0.05, 12, 12]} />
      </mesh>
      <mesh ref={leftPupilRef} position={[-0.14, 1.55, 0.35]} material={materials.pupil}>
        <sphereGeometry args={[0.028, 8, 8]} />
      </mesh>

      <mesh ref={rightEyeRef} position={[0.14, 1.55, 0.31]} material={materials.eyeWhite}>
        <sphereGeometry args={[0.08, 16, 16]} />
      </mesh>
      <mesh position={[0.14, 1.55, 0.31]} scale={[0.6, 1, 0.6]} material={materials.eyeIris}>
        <sphereGeometry args={[0.05, 12, 12]} />
      </mesh>
      <mesh ref={rightPupilRef} position={[0.14, 1.55, 0.35]} material={materials.pupil}>
        <sphereGeometry args={[0.028, 8, 8]} />
      </mesh>

      <mesh ref={mouthRef} position={[0, 1.44, 0.31]} material={materials.mouth}>
        <boxGeometry args={[0.26, 0.09, 0.045]} />
      </mesh>

      <mesh position={[0, 0.74, 0]} rotation={[0.55, 0, 0]} material={materials.arm}>
        <cylinderGeometry args={[0.02, 0.2, 0.6, 8]} />
      </mesh>
      <mesh position={[0.28, 0.68, 0]} rotation={[-0.25, 0, -0.2]} material={materials.arm}>
        <cylinderGeometry args={[0.012, 0.12, 0.7, 8]} />
      </mesh>
      <mesh position={[-0.28, 0.68, 0]} rotation={[-0.25, 0, 0.2]} material={materials.arm}>
        <cylinderGeometry args={[0.012, 0.12, 0.7, 8]} />
      </mesh>
    </group>
  );
}

export function Girlfriend3D({ emotion, speaking }: Girlfriend3DProps) {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;

  return (
    <div className="avatar-3d-shell" aria-label="3D数字女友形象">
      <Canvas camera={{ position: [0, 1.2, 3.2], fov: 42 }} dpr={dpr} shadows>
        <ambientLight intensity={0.45} />
        <directionalLight castShadow position={[3, 5, 4]} intensity={1.2} color="#ffd6e7" />
        <directionalLight position={[-2, 2, -2]} intensity={0.35} color="#7ea8ff" />
        <spotLight position={[-4, 4, 2]} angle={0.38} penumbra={0.7} intensity={0.35} color="#ffffff" />
        <GirlBody emotion={emotion} speaking={speaking} />
      </Canvas>
    </div>
  );
}
