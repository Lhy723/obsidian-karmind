import {useCallback, useEffect, useRef, useState} from 'react';
import {motion, useAnimationFrame, useMotionValue, useTransform} from 'motion/react';

interface ShinyTextProps {
	text: string;
	disabled?: boolean;
	speed?: number;
	className?: string;
	color?: string;
	shineColor?: string;
	spread?: number;
	yoyo?: boolean;
	pauseOnHover?: boolean;
	direction?: 'left' | 'right';
	delay?: number;
}

export function ShinyText({
	text,
	disabled = false,
	speed = 2,
	className = '',
	color = '#b5b5b5',
	shineColor = '#ffffff',
	spread = 120,
	yoyo = false,
	pauseOnHover = false,
	direction = 'left',
	delay = 0,
}: ShinyTextProps) {
	const [isPaused, setIsPaused] = useState(false);
	const progress = useMotionValue(0);
	const elapsedRef = useRef(0);
	const lastTimeRef = useRef<number | null>(null);
	const directionRef = useRef(direction === 'left' ? 1 : -1);
	const animationDuration = speed * 1000;
	const delayDuration = delay * 1000;

	useAnimationFrame((time) => {
		if (disabled || isPaused) {
			lastTimeRef.current = null;
			return;
		}

		if (lastTimeRef.current === null) {
			lastTimeRef.current = time;
			return;
		}

		const deltaTime = time - lastTimeRef.current;
		lastTimeRef.current = time;
		elapsedRef.current += deltaTime;

		const cycleDuration = animationDuration + delayDuration;
		const fullCycle = yoyo ? cycleDuration * 2 : cycleDuration;
		const cycleTime = elapsedRef.current % fullCycle;
		const forward = directionRef.current === 1;

		if (cycleTime < animationDuration) {
			const value = (cycleTime / animationDuration) * 100;
			progress.set(forward ? value : 100 - value);
		} else if (yoyo && cycleTime >= cycleDuration && cycleTime < cycleDuration + animationDuration) {
			const reverseTime = cycleTime - cycleDuration;
			const value = 100 - (reverseTime / animationDuration) * 100;
			progress.set(forward ? value : 100 - value);
		} else {
			progress.set(forward ? 100 : 0);
		}
	});

	useEffect(() => {
		directionRef.current = direction === 'left' ? 1 : -1;
		elapsedRef.current = 0;
		lastTimeRef.current = null;
		progress.set(0);
	}, [direction, progress]);

	const backgroundPosition = useTransform(progress, value => `${150 - value * 2}% center`);

	const handleMouseEnter = useCallback(() => {
		if (pauseOnHover) setIsPaused(true);
	}, [pauseOnHover]);

	const handleMouseLeave = useCallback(() => {
		if (pauseOnHover) setIsPaused(false);
	}, [pauseOnHover]);

	return (
		<motion.span
			className={`karmind-shiny-text ${className}`}
			style={{
				backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
				backgroundSize: '200% auto',
				WebkitBackgroundClip: 'text',
				backgroundClip: 'text',
				WebkitTextFillColor: 'transparent',
				backgroundPosition,
			}}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			{text}
		</motion.span>
	);
}
