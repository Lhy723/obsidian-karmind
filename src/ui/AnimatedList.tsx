import {useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent} from 'react';
import {motion, useInView} from 'motion/react';

interface AnimatedItemProps {
	children: ReactNode;
	delay?: number;
	index: number;
	onMouseEnter: () => void;
	onClick: () => void;
}

function AnimatedItem({children, delay = 0, index, onMouseEnter, onClick}: AnimatedItemProps) {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, {amount: 0.35, once: false});

	return (
		<motion.div
			ref={ref}
			data-index={index}
			onMouseEnter={onMouseEnter}
			onClick={onClick}
			initial={{scale: 0.96, opacity: 0, y: 8}}
			animate={inView ? {scale: 1, opacity: 1, y: 0} : {scale: 0.96, opacity: 0, y: 8}}
			transition={{duration: 0.18, delay}}
			className="karmind-animated-list-item-shell"
		>
			{children}
		</motion.div>
	);
}

interface AnimatedListProps<T> {
	items: T[];
	renderItem: (item: T, index: number, selected: boolean) => ReactNode;
	getItemKey?: (item: T, index: number) => string;
	onItemSelect?: (item: T, index: number) => void;
	showGradients?: boolean;
	enableArrowNavigation?: boolean;
	className?: string;
	displayScrollbar?: boolean;
	initialSelectedIndex?: number;
}

export function AnimatedList<T>({
	items,
	renderItem,
	getItemKey,
	onItemSelect,
	showGradients = true,
	enableArrowNavigation = true,
	className = '',
	displayScrollbar = true,
	initialSelectedIndex = -1,
}: AnimatedListProps<T>) {
	const listRef = useRef<HTMLDivElement>(null);
	const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
	const [keyboardNav, setKeyboardNav] = useState(false);
	const [topGradientOpacity, setTopGradientOpacity] = useState(0);
	const [bottomGradientOpacity, setBottomGradientOpacity] = useState(1);

	const handleItemMouseEnter = useCallback((index: number) => {
		setSelectedIndex(index);
	}, []);

	const handleItemClick = useCallback((item: T, index: number) => {
		setSelectedIndex(index);
		onItemSelect?.(item, index);
	}, [onItemSelect]);

	const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
		const {scrollTop, scrollHeight, clientHeight} = event.currentTarget;
		setTopGradientOpacity(Math.min(scrollTop / 40, 1));
		const bottomDistance = scrollHeight - (scrollTop + clientHeight);
		setBottomGradientOpacity(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 40, 1));
	}, []);

	const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
		if (!enableArrowNavigation) return;
		if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
			event.preventDefault();
			setKeyboardNav(true);
			setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
		} else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
			event.preventDefault();
			setKeyboardNav(true);
			setSelectedIndex(prev => Math.max(prev - 1, 0));
		} else if (event.key === 'Enter' && selectedIndex >= 0 && selectedIndex < items.length) {
			event.preventDefault();
			const selectedItem = items[selectedIndex];
			if (selectedItem) {
				onItemSelect?.(selectedItem, selectedIndex);
			}
		}
	}, [enableArrowNavigation, items, onItemSelect, selectedIndex]);

	useEffect(() => {
		if (!keyboardNav || selectedIndex < 0 || !listRef.current) return;

		const container = listRef.current;
		const selectedItem = container.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
		if (selectedItem) {
			const extraMargin = 36;
			const containerScrollTop = container.scrollTop;
			const containerHeight = container.clientHeight;
			const itemTop = selectedItem.offsetTop;
			const itemBottom = itemTop + selectedItem.offsetHeight;

			if (itemTop < containerScrollTop + extraMargin) {
				container.scrollTo({top: itemTop - extraMargin, behavior: 'smooth'});
			} else if (itemBottom > containerScrollTop + containerHeight - extraMargin) {
				container.scrollTo({top: itemBottom - containerHeight + extraMargin, behavior: 'smooth'});
			}
		}
		setKeyboardNav(false);
	}, [keyboardNav, selectedIndex]);

	return (
		<div className={`karmind-animated-list-container ${className}`}>
			<div
				ref={listRef}
				className={`karmind-animated-list ${!displayScrollbar ? 'karmind-no-scrollbar' : ''}`}
				onScroll={handleScroll}
				onKeyDown={handleKeyDown}
				tabIndex={enableArrowNavigation ? 0 : undefined}
			>
				{items.map((item, index) => (
					<AnimatedItem
						key={getItemKey?.(item, index) ?? String(index)}
						delay={Math.min(index * 0.025, 0.12)}
						index={index}
						onMouseEnter={() => handleItemMouseEnter(index)}
						onClick={() => handleItemClick(item, index)}
					>
						{renderItem(item, index, selectedIndex === index)}
					</AnimatedItem>
				))}
			</div>
			{showGradients && (
				<>
					<div className="karmind-list-top-gradient" style={{opacity: topGradientOpacity}} />
					<div className="karmind-list-bottom-gradient" style={{opacity: bottomGradientOpacity}} />
				</>
			)}
		</div>
	);
}
