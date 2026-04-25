import {useEffect, useMemo, useRef, useState} from 'react';
import {motion, type TargetAndTransition} from 'motion/react';

type AnimationValue = string | number;
type AnimationSnapshot = Record<string, AnimationValue>;

function buildKeyframes(from: AnimationSnapshot, steps: AnimationSnapshot[]): TargetAndTransition {
	const keys = new Set([...Object.keys(from), ...steps.flatMap(step => Object.keys(step))]);
	const keyframes: Record<string, AnimationValue[]> = {};

	keys.forEach((key) => {
		let previous = from[key] ?? steps.find(step => step[key] !== undefined)?.[key] ?? 0;
		keyframes[key] = [previous, ...steps.map((step) => {
			previous = step[key] ?? previous;
			return previous;
		})];
	});

	return keyframes as TargetAndTransition;
}

interface BlurTextProps {
	text: string;
	delay?: number;
	className?: string;
	animateBy?: 'words' | 'letters';
	direction?: 'top' | 'bottom';
	threshold?: number;
	rootMargin?: string;
	animationFrom?: AnimationSnapshot;
	animationTo?: AnimationSnapshot[];
	easing?: (value: number) => number;
	onAnimationComplete?: () => void;
	stepDuration?: number;
}

export function BlurText({
	text,
	delay = 18,
	className = '',
	animateBy = 'words',
	direction = 'top',
	threshold = 0.1,
	rootMargin = '0px',
	animationFrom,
	animationTo,
	easing = value => value,
	onAnimationComplete,
	stepDuration = 0.26,
}: BlurTextProps) {
	const elements = useMemo(() => animateBy === 'words' ? text.split(' ') : text.split(''), [animateBy, text]);
	const [inView, setInView] = useState(false);
	const ref = useRef<HTMLParagraphElement>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const observer = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting) {
				setInView(true);
				observer.unobserve(element);
			}
		}, {threshold, rootMargin});

		observer.observe(element);
		return () => observer.disconnect();
	}, [threshold, rootMargin, text]);

	const defaultFrom = useMemo<AnimationSnapshot>(() => (
		direction === 'top'
			? {filter: 'blur(10px)', opacity: 0, y: -14}
			: {filter: 'blur(10px)', opacity: 0, y: 14}
	), [direction]);

	const defaultTo = useMemo<AnimationSnapshot[]>(() => [
		{
			filter: 'blur(5px)',
			opacity: 0.45,
			y: direction === 'top' ? 3 : -3,
		},
		{filter: 'blur(0px)', opacity: 1, y: 0},
	], [direction]);

	const fromSnapshot = animationFrom ?? defaultFrom;
	const toSnapshots = animationTo ?? defaultTo;
	const stepCount = toSnapshots.length + 1;
	const totalDuration = stepDuration * (stepCount - 1);
	const times = Array.from({length: stepCount}, (_, index) => stepCount === 1 ? 0 : index / (stepCount - 1));
	const animateKeyframes = buildKeyframes(fromSnapshot, toSnapshots);

	return (
		<p ref={ref} className={className}>
			{elements.map((segment, index) => (
				<motion.span
					className="karmind-blur-text-segment"
					key={`${segment}-${index}`}
					initial={fromSnapshot}
					animate={inView ? animateKeyframes : fromSnapshot}
					transition={{
						duration: totalDuration,
						times,
						delay: (index * delay) / 1000,
						ease: easing,
					}}
					onAnimationComplete={index === elements.length - 1 ? onAnimationComplete : undefined}
				>
					{segment === ' ' ? '\u00A0' : segment}
					{animateBy === 'words' && index < elements.length - 1 && '\u00A0'}
				</motion.span>
			))}
		</p>
	);
}
