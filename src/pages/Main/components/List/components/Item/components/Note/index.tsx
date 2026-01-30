import { Flex } from "antd";
import type { FC } from "react";
import { memo } from "react";

interface NoteProps {
	value?: string;
}

const Note: FC<NoteProps> = ({ value }) => {
	return (
		<Flex
			align="center"
			gap={6}
			className="pointer-events-none h-full translate-y-[-2.5px] select-text px-2"
		>
			{/* 备注图标 */}
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="h-full max-h-[24px] w-auto flex-shrink-0 text-gray-400"
				role="img"
				aria-label="note"
			>
				<title>备注</title>
				<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
				<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
			</svg>

			<span className="truncate text-sm leading-tight">{value}</span>
		</Flex>
	);
};

export default memo(Note);
