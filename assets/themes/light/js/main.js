// Preloader area
function handlePreloader() {
    if ($('.loader-wrap').length) {
        $('.loader-wrap').delay(1000).fadeOut(300);
    }
}
$(document).ready(function () {
    handlePreloader();

    if ($(".preloader-close").length) {
        $(".preloader-close").on("click", function () {
            $('.loader-wrap').stop(true).fadeOut(300);
        });
    }
});
// Preloader area end

// toggleSideMenu start
const toggleSideMenu = () => {
    document.body.classList.toggle("toggle-sidebar");
};
// toggleSideMenu end

// add bg to nav
window.addEventListener("scroll", function () {
    let scrollpos = window.scrollY;
    const header = document.querySelector("nav");
    const headerHeight = header.offsetHeight;

    if (scrollpos >= headerHeight) {
        header.classList.add("active");
    } else {
        header.classList.remove("active");
    }
});


$(document).ready(function () {
    // owl carousel dashboard card
    $('.carousel-area1').owlCarousel({
        loop: true,
        autoplay: false,
        margin: 10,
        nav: true,
        dots: false,
        // rtl:true,
        responsive: {
            0: {
                items: 1
            },
            400: {
                items: 2
            },
            991: {
                items: 2
            }
        }
    });

    // Swiper-slider livestream-swiper
    var swiper = new Swiper(".livestream-swiper", {
        effect: "coverflow",
        grabCursor: true,
        centeredSlides: true,
        slidesPerView: "auto",
        coverflowEffect: {
            rotate: 0,
            stretch: 0,
            depth: 100,
            modifier: 1,
            slideShadows: true,
        },
        // Navigation arrows
        navigation: {
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
        },
        loop: true,

    });
    // Testimonial section start
    const $testimonialCarousel = $('.testimonial-carousel');
    if ($testimonialCarousel.length && typeof $.fn.owlCarousel === 'function') {
        $testimonialCarousel.each(function () {
            const $carousel = $(this);
            if ($carousel.hasClass('owl-loaded')) {
                $carousel.trigger('refresh.owl.carousel');
                $carousel.trigger('play.owl.autoplay', [2400]);
                return;
            }

            $carousel.owlCarousel({
                loop: true,
                margin: 18,
                nav: false,
                dots: true,
                slideBy: 1,
                mouseDrag: true,
                touchDrag: true,
                pullDrag: true,
                autoplay: true,
                autoplayTimeout: 2400,
                autoplaySpeed: 900,
                smartSpeed: 900,
                autoplayHoverPause: true,
                responsive: {
                    0: {
                        items: 1
                    },
                    768: {
                        items: 2
                    },
                    1200: {
                        items: 3
                    }
                }
            });

            $carousel.trigger('play.owl.autoplay', [2400]);
        });
    }
    // Testimonial section end
    // cmn select2 start
    $(document).ready(function () {
        $('.cmn-select2').select2({});
    });
    // cmn select2 end

    //cmn-select2 with image start
    $(document).ready(function () {
        $('.cmn-select2-image').select2({
            templateResult: formatState,
            templateSelection: formatState
        });
    });


    function formatState(state) {
        if (!state.id) {
            return state.text;
        }
        let imageUrl = $(state.element).data('img');
        var $state = $(
            '<span><img class="img-flag" /> <span></span></span>'
        );

        $state.find("span").text(state.text);
        $state.find("img").attr("src", imageUrl);
        return $state;
    };
    // cmn-select2 with image end


    // cmn select2 modal start
    $(".modal-select").select2({
        dropdownParent: $("#formModal"),
    });
    // cmn select2 modal start

});
// Dark theme start
const toggleBtn = document.getElementById("toggle-btn");
if (toggleBtn) {
    const body = document.querySelector("body");
    toggleBtn.addEventListener("click", function () {
        document.body.classList.toggle("dark-theme");
        if (document.body.classList.contains("dark-theme")) {
            localStorage.setItem("dark-theme", 1);
        } else {
            localStorage.setItem("dark-theme", 0);
        }
        setTheme();
    });
}

var loaderColor = "rgba(250, 244, 255, 0.92)";
var loaderColorDark = "rgba(45, 24, 78, 0.94)";
var loaderColorLight = "rgba(250, 244, 255, 0.92)";

function setTheme() {
    const isDarkTheme = localStorage.getItem("dark-theme");
    const head = document.querySelector("head");
    const defaultTheme = head.getAttribute("data-theme");
    const changeable_mode = head.getAttribute("data-changeable_mode");
    if (isDarkTheme == 1) {
        $('#logoSet').attr('src', head.getAttribute("data-dark_logo"))
        $('#logoSetMobile').attr('src', head.getAttribute("data-dark_logo"))
        document.querySelector('body').classList.add('dark-theme');
        if (document.getElementById("moon")) {
            document.getElementById("moon").style.display = "none";
        }
        if (document.getElementById("sun")) {
            document.getElementById("sun").style.display = "block";
        }
        loaderColor = loaderColorDark;
    } else if (isDarkTheme == 0) {
        $('#logoSet').attr('src', head.getAttribute("data-light_logo"))
        $('#logoSetMobile').attr('src', head.getAttribute("data-light_logo"))
        document.querySelector('body').classList.remove('dark-theme');


        if (document.getElementById("moon")) {
            document.getElementById("moon").style.display = "block";
        }
        if (document.getElementById("sun")) {
            document.getElementById("sun").style.display = "none";
        }

        loaderColor = loaderColorLight;
    } else {
        if (defaultTheme == 1) {
            $('#logoSet').attr('src', head.getAttribute("data-dark_logo"))
            $('#logoSetMobile').attr('src', head.getAttribute("data-dark_logo"))
            document.querySelector('body').classList.add('dark-theme');

            if (document.getElementById("moon")) {
                document.getElementById("moon").style.display = "none";
            }
            if (document.getElementById("sun")) {
                document.getElementById("sun").style.display = "block";
            }

            loaderColor = loaderColorDark;
        } else {
            $('#logoSet').attr('src', head.getAttribute("data-light_logo"))
            $('#logoSetMobile').attr('src', head.getAttribute("data-light_logo"))
            document.querySelector('body').classList.remove('dark-theme');

            if (document.getElementById("moon")) {
                document.getElementById("moon").style.display = "block";
            }
            if (document.getElementById("sun")) {
                document.getElementById("sun").style.display = "none";
            }
            loaderColor = loaderColorLight;
        }
    }

    document.documentElement.setAttribute('data-solidus-site-theme', document.querySelector('body').classList.contains('dark-theme') ? 'dark' : 'light');
}

if (toggleBtn) {
    setTheme();
}
// Dark theme end


// input file preview
const previewImage = (id) => {
    document.getElementById(id).src = URL.createObjectURL(event.target.files[0]);
};

// Tooltip
const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

// Copy text start
function copyTextFunc() {
    // get the container
    const element = document.querySelector('.docs-code');
    // Create a fake `textarea` and set the contents to the text
    // you want to copy
    const storage = document.createElement('textarea');
    storage.value = element.innerHTML;
    element.appendChild(storage);

    // Copy the text in the fake `textarea` and remove the `textarea`
    storage.select();
    storage.setSelectionRange(0, 99999);
    document.execCommand('copy');
    element.removeChild(storage);
}

// Copy text end
// Highlight editor start
document.addEventListener('DOMContentLoaded', (event) => {
    document.querySelectorAll('pre code').forEach((el) => {
        hljs.highlightElement(el);
    });
});
// Highlight editor end


// Modal select to input focus start
document.addEventListener("DOMContentLoaded", function () {
    function handleInput(inputAmountBox, inputAmountBoxInner) {
        if (inputAmountBox && inputAmountBoxInner) {
            const inputField = inputAmountBoxInner.querySelector('input');

            inputField.addEventListener("focus", function () {
                inputAmountBox.classList.add("active");
            });

            inputField.addEventListener("blur", function () {
                inputAmountBox.classList.remove("active");
            });

            inputField.addEventListener("click", function () {
                inputField.setSelectionRange(inputField.value.length, inputField.value.length);
            });

            inputAmountBox.addEventListener("click", function (event) {
                if (!event.target.closest('.icon-area') && !event.target.closest('.text-area')) {
                    inputField.focus();
                    inputField.setSelectionRange(inputField.value.length, inputField.value.length);
                }
            });
        }
    }

    const inputAmountBox = document.getElementById("inputAmountBox");
    const inputAmountBoxInner = document.getElementById("inputAmountBoxInner");
    handleInput(inputAmountBox, inputAmountBoxInner);

    const inputAmountBox2 = document.getElementById("inputAmountBox2");
    const inputAmountBoxInner2 = document.getElementById("inputAmountBoxInner2");
    handleInput(inputAmountBox2, inputAmountBoxInner2);
});
// Modal select to input focus end

// Filter section start
function filterItems(inputId) {
    var input, filter, items, title, subtitle, i, txtValue;
    input = document.getElementById(inputId);
    filter = input.value.toUpperCase();
    items = document.querySelectorAll("#currency-list .item");

    items.forEach(function (item) {
        title = item.querySelector(".title");
        subtitle = item.querySelector(".sub-title");

        txtValue = title.textContent || title.innerText;
        txtValue += " " + (subtitle.textContent || subtitle.innerText);

        if (txtValue.toUpperCase().indexOf(filter) > -1) {
            item.style.display = "";
        } else {
            item.style.display = "none";
        }
    });
}

function filterItems2(inputId) {
    var input, filter, items, title, subtitle, i, txtValue;
    input = document.getElementById(inputId);
    filter = input.value.toUpperCase();
    items = document.querySelectorAll("#currency-list2 .item");

    items.forEach(function (item) {
        title = item.querySelector(".title");
        subtitle = item.querySelector(".sub-title");

        txtValue = title.textContent || title.innerText;
        txtValue += " " + (subtitle.textContent || subtitle.innerText);

        if (txtValue.toUpperCase().indexOf(filter) > -1) {
            item.style.display = "";
        } else {
            item.style.display = "none";
        }
    });
}

// Filter section end

// FAQ accordion performance sync
document.addEventListener('DOMContentLoaded', function () {
    const faqItems = document.querySelectorAll('.faq-section .accordion-item');
    if (!faqItems.length) return;

    faqItems.forEach(function (item) {
        const collapse = item.querySelector('.accordion-collapse');
        if (!collapse) return;

        if (collapse.classList.contains('show')) {
            item.classList.add('is-open');
        }

        collapse.addEventListener('show.bs.collapse', function () {
            item.classList.add('is-open');
        });

        collapse.addEventListener('hide.bs.collapse', function () {
            item.classList.remove('is-open');
        });
    });
});

// curved-circle start

$(window).on('load', function () {
    if ($('.curved-circle').length) {
        $('.curved-circle').circleType({
            position: 'absolute',
            dir: 1,
            radius: 59,
            forceHeight: true,
            forceWidth: true
        });
    }
});
// curved-circle end
