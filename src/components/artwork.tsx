export default function Artwork({
  variant = 0,
  className = '',
}: {
  variant?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 960 540"
      fill="none"
      role="img"
      aria-label="Illustrated storyboard placeholder, not generated footage"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient
          id={`sky${variant}`}
          x1="480"
          y1="0"
          x2="480"
          y2="540"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={variant % 3 === 1 ? '#283b43' : '#354b50'} />
          <stop offset=".55" stopColor="#81908b" />
          <stop offset="1" stopColor="#c4b79a" />
        </linearGradient>
        <linearGradient
          id={`sea${variant}`}
          x1="480"
          y1="260"
          x2="480"
          y2="540"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#647e80" />
          <stop offset="1" stopColor="#1c3a43" />
        </linearGradient>
        <radialGradient id={`glow${variant}`}>
          <stop stopColor="#f3cf83" stopOpacity=".8" />
          <stop offset="1" stopColor="#e4b465" stopOpacity="0" />
        </radialGradient>
        <filter id={`grain${variant}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".65"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope=".11" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" mode="soft-light" />
        </filter>
      </defs>
      <g filter={`url(#grain${variant})`}>
        <path fill={`url(#sky${variant})`} d="M0 0h960v540H0z" />
        <path
          d="M-20 180C160 100 220 195 390 165S660 70 1000 150M-50 220C180 180 280 245 500 200S790 160 990 190"
          stroke="#b4bcb1"
          strokeWidth="34"
          opacity=".1"
        />
        <path fill={`url(#sea${variant})`} d="M0 280c200-9 430 14 960-8v268H0z" />
        {[315, 340, 370, 405, 440, 485, 520].map((y, i) => (
          <path
            key={y}
            d={`M${i % 2 ? 0 : 120} ${y}q100 -10 210 0t230 0t240 0t240 0`}
            stroke="#c5d2c7"
            strokeWidth={i / 2 + 1}
            opacity=".15"
          />
        ))}
        <path
          d="M-20 535 160 452 242 403 350 390 414 350 485 326 537 330 615 358 657 390 734 418 799 456 960 540Z"
          fill="#263c37"
        />
        <path
          d="m0 540 220-96 112-30 100-55 64-23 48 5 68 25 28 41-92-20-34 32-80 5-56 53-143 63Z"
          fill="#4f6050"
        />
        <path d="m464 351 15-142h34l15 142Z" fill="#c8c5ad" />
        <path d="m491 212 3 139h34l-15-142Z" fill="#8b958c" />
        <path d="M473 205h46v13h-46zM475 180h42v25h-42z" fill="#263b39" />
        <path d="m470 180 26-15 27 15Z" fill="#243634" />
        <path d="M481 185h10v14h-10zM496 185h14v14h-14z" fill="#f0cb81" />
        <ellipse cx="497" cy="192" rx="110" ry="58" fill={`url(#glow${variant})`} />
        <path d="m503 190 290-50v108Z" fill="#f6ddb0" opacity=".07" />
        <path d="M490 318h10v34h-10zM492 248h8v14h-8zM490 282h9v14h-9z" fill="#334c49" />
        <path d="M427 345h42v-34h-42z" fill="#a6a58d" />
        <path d="m419 312 28-23 29 23Z" fill="#31443d" />
        <path d="M0 480c167-20 220-35 358-70S578 386 960 502v38H0Z" fill="#99a99c" opacity=".11" />
        {variant % 3 === 1 && (
          <g>
            <path d="M0 0h290v540H0zM850 0h110v540H850z" fill="#152827" opacity=".85" />
            <path d="M280 0h13v540h-13zM0 105h960v12H0z" fill="#192c29" />
            <path d="M602 540c-5-55-8-120-30-153l-65-12-41 45-17 120Z" fill="#1c2d2b" />
            <ellipse cx="529" cy="353" rx="26" ry="36" fill="#27372f" />
            <path d="m504 385 20 26 38-21" stroke="#906747" strokeWidth="16" />
          </g>
        )}
        {variant % 3 === 2 && (
          <g>
            <path d="M0 395 960 345v195H0Z" fill="#263632" />
            <ellipse cx="510" cy="416" rx="135" ry="75" fill="#142824" />
            <ellipse cx="500" cy="403" rx="100" ry="58" fill="#ad9660" />
            <ellipse cx="500" cy="398" rx="87" ry="47" fill="#30483e" />
            <path d="m500 358 15 42-15 33-10-33Z" fill="#e3c37e" />
            <ellipse
              cx="500"
              cy="399"
              rx="160"
              ry="100"
              fill={`url(#glow${variant})`}
              opacity=".45"
            />
          </g>
        )}
        <path fill="#0c161b" opacity=".15" d="M0 0h960v540H0z" />
      </g>
    </svg>
  );
}
