import '../content/style.css';

function Popup() {
  return (
    <main className="webbutler:min-h-40 webbutler:w-72 webbutler:bg-white webbutler:p-4 webbutler:text-[#171717]">
      <h1 className="webbutler:text-lg webbutler:font-semibold">Web Butler</h1>
      <p className="webbutler:mt-2 webbutler:text-sm webbutler:text-[#737373]">
        Open any page. The in-page prompt mounts in a shadow root with prefixed
        Tailwind classes.
      </p>
    </main>
  );
}

export default Popup;
